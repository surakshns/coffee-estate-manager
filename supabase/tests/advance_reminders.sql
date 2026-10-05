-- Local/test database regression check, after all migrations. No push requests.
-- Fixtures and all scheduler state are rolled back, including on assertion error.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_one uuid := gen_random_uuid();
  v_two uuid := gen_random_uuid();
  v_three uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_due timestamptz := date_trunc('minute', now() - interval '1 minute');
  v_date date;
  v_week date;
  v_rows jsonb;
  v_count integer;
  v_id uuid;
  v_rejected boolean;
begin
  v_date := (v_due at time zone 'Asia/Kolkata')::date;
  v_week := v_date - ((extract(dow from v_date)::integer + 4) % 7);
  insert into auth.users (id, email) values (v_user, v_user || '@reminder-test.invalid'), (v_other, v_other || '@reminder-test.invalid');
  insert into public.workers (id, user_id, name, active) values
    (v_one, v_user, 'Reminder fixture one', true),
    (v_two, v_user, 'Reminder fixture two', true),
    (v_foreign, v_other, 'Other account fixture', true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  if has_table_privilege('authenticated', 'public.weekly_pay_runs', 'INSERT') then raise exception 'Clients can manufacture completion markers.'; end if;
  if has_function_privilege('authenticated', 'public.claim_due_advance_reminders(integer)', 'EXECUTE') then raise exception 'Clients can invoke the scheduler claim.'; end if;
  if has_function_privilege('anon', 'public.finish_advance_reminder(uuid,text,integer)', 'EXECUTE') then raise exception 'Anonymous callers can mutate delivery results.'; end if;

  v_rows := jsonb_build_array(jsonb_build_object('worker_id', v_one, 'days_worked', 0, 'daily_rate', 10, 'excluded', false, 'personal_deduction', 0));
  perform public.save_weekly_labour(v_week, v_rows);
  if not exists (select 1 from public.weekly_payments where user_id = v_user and week_start = v_week) then raise exception 'Partial saves no longer preserve payments.'; end if;
  if exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week) then raise exception 'A partial week became complete.'; end if;

  v_rows := v_rows || jsonb_build_array(jsonb_build_object('worker_id', v_two, 'days_worked', 0, 'daily_rate', 10, 'excluded', true, 'personal_deduction', 0));
  perform public.save_weekly_labour(v_week, v_rows);
  if not exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week and cardinality(worker_ids) = 2) then raise exception 'Zero-pay/skipped full saves are not complete.'; end if;
  insert into public.workers (id, user_id, name, active) values (v_three, v_user, 'Later joining fixture', true);
  if not exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week and cardinality(worker_ids) = 2) then raise exception 'A later join changed the completion snapshot.'; end if;

  update public.weekly_payments set amount = 0 where user_id = v_user and worker_id = v_one and week_start = v_week;
  if exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week) then raise exception 'Direct/imported payment edits did not invalidate completion.'; end if;
  v_rows := v_rows || jsonb_build_array(jsonb_build_object('worker_id', v_three, 'days_worked', 0, 'daily_rate', 10, 'excluded', false, 'personal_deduction', 0));
  perform public.save_weekly_labour(v_week, v_rows);
  if not exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week and cardinality(worker_ids) = 3) then raise exception 'The full review did not restore completion.'; end if;

  insert into public.worker_loans (user_id, worker_id, loan_date, amount, kind, notes) values (v_user, v_one, v_week - 1, 100, 'advance', 'Synthetic loan fixture');
  v_rows := jsonb_build_array(jsonb_build_object('worker_id', v_one, 'days_worked', 1, 'daily_rate', 10, 'excluded', false, 'personal_deduction', 2)) || (v_rows - 0);
  perform public.save_weekly_labour(v_week, v_rows);
  perform public.save_weekly_labour(v_week, v_rows);
  select count(*) into v_count from public.worker_loans where user_id = v_user and kind = 'repayment' and notes = 'Repayment recorded with weekly payment';
  if v_count <> 1 then raise exception 'Saving/retrying duplicated linked repayments.'; end if;
  perform public.clear_weekly_labour(v_week);
  if exists (select 1 from public.weekly_pay_runs where user_id = v_user and week_start = v_week) then raise exception 'Clearing left a completion marker.'; end if;
  if exists (select 1 from public.weekly_payments where user_id = v_user and week_start = v_week) then raise exception 'Clearing left wage records.'; end if;
  if exists (select 1 from public.worker_loans where user_id = v_user and kind = 'repayment') then raise exception 'Clearing left linked loan deductions.'; end if;
  if not exists (select 1 from public.worker_loans where user_id = v_user and kind = 'advance') then raise exception 'Clearing removed a manual advance.'; end if;

  v_rejected := false;
  begin
    perform public.save_weekly_labour(v_week, jsonb_build_array(jsonb_build_object('worker_id', v_foreign, 'days_worked', 1, 'daily_rate', 10, 'excluded', false, 'personal_deduction', 0)));
  exception when others then v_rejected := position('Worker does not belong' in SQLERRM) > 0;
  end;
  if not v_rejected then raise exception 'SECURITY DEFINER accepted another account worker.'; end if;

  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth, connected_at) values
    (v_user, 'https://web.push.apple.com/' || v_user, 'local-test-key', 'local-test-auth', v_due - interval '1 minute'),
    (v_user, 'https://fcm.googleapis.com/' || v_user, 'local-test-key', 'local-test-auth', v_due - interval '1 minute');
  insert into public.advance_reminder_settings (user_id, enabled, weekday, reminder_time, updated_at) values
    (v_user, true, extract(dow from v_date)::integer, (v_due at time zone 'Asia/Kolkata')::time, now());
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'A reminder enabled after its slot sent retroactively.'; end if;
  delete from public.advance_reminder_settings where user_id = v_user;
  insert into public.advance_reminder_settings (user_id, enabled, weekday, reminder_time, updated_at) values
    (v_user, true, extract(dow from v_date)::integer, (v_due at time zone 'Asia/Kolkata')::time, v_due - interval '1 minute');

  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth) values
    (v_user, 'https://web.push.apple.com/late-' || v_user, 'local-test-key', 'local-test-auth');

  -- An imported row is not a completion marker and should remain reviewable.
  insert into public.weekly_payments (user_id, worker_id, week_start, amount) values (v_user, v_one, v_week, 0);
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 2 then raise exception 'Eligible unsaved/review weeks did not claim both phones: %', v_count; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and endpoint = 'https://web.push.apple.com/late-' || v_user) then raise exception 'A newly connected phone received a past slot.'; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'Overlapping cron calls reclaimed sending notifications.'; end if;
  select id into v_id from public.advance_reminder_deliveries where user_id = v_user and endpoint like 'https://web.push.apple.com/%';
  perform public.finish_advance_reminder(v_id, 'sent', 201);
  select id into v_id from public.advance_reminder_deliveries where user_id = v_user and endpoint like 'https://fcm.googleapis.com/%';
  perform public.finish_advance_reminder(v_id, 'retry', 503);
  update public.advance_reminder_deliveries set next_attempt_at = now() - interval '1 second' where id = v_id;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 1 then raise exception 'Explicit transient failures were not retryable.'; end if;
  perform public.finish_advance_reminder(v_id, 'uncertain', null);
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'An uncertain or sent result was resent.'; end if;

  delete from public.advance_push_subscriptions where user_id = v_user and endpoint like 'https://web.push.apple.com/%';
  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth) values (v_user, 'https://web.push.apple.com/' || v_user, 'local-test-key', 'local-test-auth');
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'Resubscribing created a duplicate Wednesday notification.'; end if;

  perform public.clear_weekly_labour(v_week);
  update public.workers set active = false where user_id = v_user;
  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth) values (v_user, 'https://web.push.apple.com/new-' || v_user, 'local-test-key', 'local-test-auth');
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'An account with no eligible workers was notified.'; end if;
end;
$$;

rollback;
