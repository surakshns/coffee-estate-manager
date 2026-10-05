-- Local/test database checks after all migrations. No push requests; rolls back.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_missed uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_due timestamptz := date_trunc('minute', now() - interval '1 minute');
  v_date date := (v_due at time zone 'Asia/Kolkata')::date;
  v_week date := v_date - ((extract(dow from v_date)::integer + 4) % 7) - 7;
  v_count integer;
  v_id uuid;
  v_revision bigint;
  v_settings_at timestamptz;
  v_expected_start timestamptz;
  v_rows jsonb;
begin
  insert into auth.users (id, email) values (v_user, v_user || '@daily-reminder.invalid'), (v_other, v_other || '@reschedule-reminder.invalid'), (v_missed, v_missed || '@missed-reminder.invalid');
  insert into public.workers (id, user_id, name, active) values
    (v_worker, v_user, 'Daily reminder fixture', true), (v_second, v_user, 'Second daily fixture', true);
  insert into public.workers (user_id, name, active) values (v_missed, 'Missed first reminder fixture', true);
  insert into public.advance_reminder_settings (user_id, enabled, weekday, reminder_time, updated_at) values
    (v_user, true, (extract(dow from v_date)::integer + 1) % 7, (v_due at time zone 'Asia/Kolkata')::time, v_due - interval '21 days'),
    (v_other, true, (extract(dow from v_date)::integer + 1) % 7, (v_due at time zone 'Asia/Kolkata')::time, v_due - interval '21 days'),
    (v_missed, true, (extract(dow from v_date)::integer + 6) % 7, (v_due at time zone 'Asia/Kolkata')::time, v_due - interval '21 days');
  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth, connected_at) values
    (v_user, 'https://web.push.apple.com/daily-' || v_user, 'test-key', 'test-auth', v_due - interval '21 days'),
    (v_user, 'https://fcm.googleapis.com/daily-' || v_user, 'test-key', 'test-auth', v_due - interval '21 days'),
    (v_user, 'https://web.push.apple.com/late-' || v_user, 'test-key', 'test-auth', now()),
    (v_other, 'https://web.push.apple.com/reschedule-' || v_other, 'test-key', 'test-auth', v_due - interval '21 days'),
    (v_other, 'https://fcm.googleapis.com/reschedule-' || v_other, 'test-key', 'test-auth', v_due - interval '21 days'),
    (v_missed, 'https://web.push.apple.com/missed-' || v_missed, 'test-key', 'test-auth', v_due - interval '21 days');
  insert into public.advance_reminder_weeks (user_id, week_start, starts_at) values
    (v_user, v_week, v_due - interval '7 days'), (v_user, v_week - 7, v_due - interval '14 days');
  -- The current week's payment is already complete; older pending weeks must
  -- keep their own reminders without creating another current-week reminder.
  insert into public.weekly_pay_runs (user_id, week_start, worker_ids) values (v_user, v_week + 7, array[v_worker, v_second]);
  insert into public.advance_reminder_deliveries (user_id, week_start, subscription_id, endpoint, scheduled_at, status, sent_at)
  select v_user, v_week, p.id, p.endpoint, v_due - interval '1 day', 'sent', v_due - interval '1 day'
  from public.advance_push_subscriptions p where p.user_id = v_user and p.connected_at < v_due;

  if has_table_privilege('authenticated', 'public.advance_reminder_weeks', 'INSERT') then raise exception 'Clients can manufacture pending reminder weeks.'; end if;
  if has_function_privilege('authenticated', 'public.queue_advance_reminder_reschedule()', 'EXECUTE') then raise exception 'Clients can invoke the reschedule trigger.'; end if;

  -- Today is not the selected initial weekday. Both pending older Wednesdays
  -- still repeat on both phones, even after yesterday's successful send.
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 4 then raise exception 'Daily repeats did not preserve both older pay weeks on both phones: %', v_count; end if;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_missed and status = 'sending' and kind = 'payment' and scheduled_at = v_due;
  if v_count <> 1 then raise exception 'Missing the first cron slot prevented the next daily reminder.'; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and scheduled_at = v_due and (week_start not in (v_week, v_week - 7) or endpoint like '%/late-%')) then raise exception 'Daily reminder changed its pay week or included a late phone.'; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'Concurrent/repeated scheduler calls duplicated a daily slot.'; end if;
  for v_id in select id from public.advance_reminder_deliveries where user_id = v_user and status = 'sending' loop
    perform public.finish_advance_reminder(v_id, 'retry', 503);
  end loop;
  update public.advance_reminder_deliveries set next_attempt_at = now() where user_id = v_user and status = 'retry';

  -- A partial payment/import still needs reminders for the exact pending week.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  v_rows := jsonb_build_array(jsonb_build_object('worker_id', v_worker, 'days_worked', 0, 'daily_rate', 10, 'excluded', false, 'personal_deduction', 0));
  perform public.save_weekly_labour(v_week, v_rows);
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 4 then raise exception 'A partial weekly update stopped daily reminders: %', v_count; end if;
  for v_id in select id from public.advance_reminder_deliveries where user_id = v_user and status = 'sending' loop
    perform public.finish_advance_reminder(v_id, 'retry', 503);
  end loop;
  update public.advance_reminder_deliveries set next_attempt_at = now() where user_id = v_user and status = 'retry';

  -- Full zero-pay/skipped saves cancel only that week's remaining reminders.
  v_rows := v_rows || jsonb_build_array(jsonb_build_object('worker_id', v_second, 'days_worked', 0, 'daily_rate', 10, 'excluded', true, 'personal_deduction', 0));
  perform public.save_weekly_labour(v_week, v_rows);
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 2 then raise exception 'Full save failed to stop its reminders or stopped another pending week: %', v_count; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and week_start = v_week) then raise exception 'Completed week remained in daily tracking.'; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and week_start = v_week and status in ('pending', 'retry', 'sending')) then raise exception 'Saved week still has queued daily reminders.'; end if;

  -- Reschedule confirmations are independent of workers and saved payments.
  insert into public.weekly_pay_runs (user_id, week_start, worker_ids) values
    (v_other, v_date - ((extract(dow from v_date)::integer + 4) % 7), array[gen_random_uuid()]);
  update public.advance_reminder_settings set weekday = (weekday + 1) % 7 where user_id = v_other;
  select revision, updated_at into v_revision, v_settings_at from public.advance_reminder_settings where user_id = v_other;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_other and kind = 'rescheduled' and status = 'pending';
  if v_count <> 2 then raise exception 'Rescheduling did not queue confirmations for both phones: %', v_count; end if;
  update public.advance_reminder_settings set weekday = weekday, reminder_time = reminder_time where user_id = v_other;
  if not exists (select 1 from public.advance_reminder_settings where user_id = v_other and revision = v_revision and updated_at = v_settings_at) then raise exception 'Unchanged save restarted the schedule.'; end if;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_other;
  if v_count <> 2 then raise exception 'Unchanged schedule duplicated reschedule alerts.'; end if;

  -- A second edit in the same transaction has the same timestamp but must
  -- cancel the old revision and enqueue the new schedule for each phone.
  update public.advance_reminder_settings set reminder_time = (reminder_time + interval '1 minute')::time where user_id = v_other;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_other and status = 'pending' and settings_revision = v_revision + 1;
  if v_count <> 2 then raise exception 'A second reschedule failed to replace stale alerts.'; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_other;
  if v_count <> 2 then raise exception 'Saved/no-worker account lost its reschedule confirmations: %', v_count; end if;
  for v_id in select id from public.advance_reminder_deliveries where user_id = v_other and status = 'sending' loop
    perform public.finish_advance_reminder(v_id, 'retry', 503);
  end loop;
  update public.advance_reminder_settings set enabled = false where user_id = v_other;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_other and status in ('pending', 'retry')) then raise exception 'Disabling did not cancel reschedule alerts.'; end if;
  update public.advance_reminder_settings set weekday = (weekday + 1) % 7 where user_id = v_other;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_other;
  if v_count <> 4 then raise exception 'Editing a disabled schedule sent notifications.'; end if;

  -- A weekday edit preserves the daily cadence for already-started pay weeks.
  -- The selected weekday controls first reminders, not an older week's repeats.
  update public.advance_reminder_settings set weekday = (extract(dow from v_date)::integer + 2) % 7 where user_id = v_user;
  select (((now() at time zone timezone)::date + reminder_time) at time zone timezone)
    into v_expected_start from public.advance_reminder_settings where user_id = v_user;
  if v_expected_start < now() then v_expected_start := v_expected_start + interval '1 day'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and (starts_at <> v_expected_start or week_start <> v_week - 7)) then raise exception 'Reschedule postponed a daily reminder or lost the pending pay date.'; end if;
  update public.advance_reminder_settings set enabled = false where user_id = v_user;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id in (v_user, v_other);
  if v_count <> 0 then raise exception 'Disabled accounts still claimed notifications.'; end if;
end;
$$;

rollback;
