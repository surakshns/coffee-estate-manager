-- Local/test database checks after all migrations. No push requests; rolls back.
-- Run at arbitrary clocks, including India midnight and year boundaries.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_no_phone uuid := gen_random_uuid();
  v_completed uuid := gen_random_uuid();
  v_fresh uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_completed_worker uuid := gen_random_uuid();
  v_phone uuid := gen_random_uuid();
  v_second_phone uuid := gen_random_uuid();
  v_sent uuid := gen_random_uuid();
  v_sending uuid := gen_random_uuid();
  v_local timestamp := now() at time zone 'Asia/Kolkata';
  v_date date := v_local::date;
  v_week date := v_date - ((extract(dow from v_date)::integer + 4) % 7) - 7;
  -- At 23:59 the next selectable minute is tomorrow. Otherwise this is today.
  v_next_local timestamp := date_trunc('minute', v_local) + interval '1 minute';
  v_next_at timestamptz := v_next_local at time zone 'Asia/Kolkata';
  v_old_time time := (v_next_local + interval '30 minutes')::time;
  v_expected_start timestamptz;
  v_revision bigint;
  v_settings_at timestamptz;
  v_count integer;
begin
  insert into auth.users (id, email) values
    (v_user, v_user || '@daily-reschedule.invalid'),
    (v_no_phone, v_no_phone || '@no-phone-reschedule.invalid'),
    (v_completed, v_completed || '@completed-reschedule.invalid'),
    (v_fresh, v_fresh || '@first-reschedule.invalid');
  insert into public.workers (id, user_id, name, active) values
    (v_worker, v_user, 'Reschedule fixture', true),
    (v_completed_worker, v_completed, 'Completed reschedule fixture', true);
  insert into public.workers (user_id, name, active) values
    (v_no_phone, 'No active phone fixture', true),
    (v_fresh, 'First reminder fixture', true);
  insert into public.advance_reminder_settings (user_id, enabled, weekday, reminder_time, updated_at) values
    (v_user, true, (extract(dow from v_date)::integer + 2) % 7, v_old_time, now() - interval '21 days'),
    (v_no_phone, true, (extract(dow from v_date)::integer + 2) % 7, v_old_time, now()),
    (v_completed, true, (extract(dow from v_date)::integer + 2) % 7, v_old_time, now()),
    (v_fresh, true, (extract(dow from v_date)::integer + 2) % 7, v_old_time, now());
  insert into public.advance_push_subscriptions (id, user_id, endpoint, p256dh, auth, connected_at) values
    (v_phone, v_user, 'https://web.push.apple.com/daily-reschedule-' || v_user, 'test-key', 'test-auth', now() - interval '21 days'),
    (v_second_phone, v_user, 'https://fcm.googleapis.com/daily-reschedule-' || v_user, 'test-key', 'test-auth', now() - interval '21 days');
  insert into public.advance_push_subscriptions (user_id, endpoint, p256dh, auth, connected_at, expiration_time) values
    (v_user, 'https://web.push.apple.com/expired-reschedule-' || v_user, 'test-key', 'test-auth', now() - interval '21 days', now() - interval '1 minute'),
    (v_no_phone, 'https://web.push.apple.com/no-phone-reschedule-' || v_no_phone, 'test-key', 'test-auth', now() - interval '21 days', now() - interval '1 minute'),
    (v_completed, 'https://web.push.apple.com/completed-reschedule-' || v_completed, 'test-key', 'test-auth', now() - interval '21 days', null),
    (v_fresh, 'https://web.push.apple.com/first-reschedule-' || v_fresh, 'test-key', 'test-auth', now() - interval '21 days', null);
  insert into public.advance_reminder_weeks (user_id, week_start, starts_at) values
    (v_user, v_week, now() - interval '7 days'),
    (v_user, v_week - 7, now() - interval '14 days'),
    (v_no_phone, v_week, now() - interval '7 days'),
    (v_completed, v_week, now() - interval '7 days');
  insert into public.weekly_pay_runs (user_id, week_start, worker_ids) values
    (v_completed, v_week, array[v_completed_worker]);
  insert into public.advance_reminder_deliveries
    (id, user_id, week_start, subscription_id, endpoint, scheduled_at, status, sent_at, claimed_at, settings_revision) values
    (v_sent, v_user, v_week, v_phone, 'https://web.push.apple.com/daily-reschedule-' || v_user, now() - interval '1 day', 'sent', now() - interval '1 day', null, 1),
    (v_sending, v_user, v_week, v_phone, 'https://web.push.apple.com/daily-reschedule-' || v_user, now() - interval '1 minute', 'sending', null, now(), 1);
  insert into public.advance_reminder_deliveries
    (user_id, week_start, subscription_id, endpoint, scheduled_at, status, settings_revision) values
    (v_user, v_week, v_phone, 'https://web.push.apple.com/daily-reschedule-' || v_user, now() + interval '20 minutes', 'pending', 1),
    (v_user, v_week - 7, v_second_phone, 'https://fcm.googleapis.com/daily-reschedule-' || v_user, now() + interval '20 minutes', 'retry', 1);

  -- A time-only edit on a nonselected weekday must use the next daily time,
  -- even if the old occurrence was already sent. Keep both original pay weeks.
  update public.advance_reminder_settings set reminder_time = v_next_local::time where user_id = v_user;
  select revision, updated_at into v_revision, v_settings_at from public.advance_reminder_settings where user_id = v_user;
  if v_revision <> 2 or v_settings_at <> now() then raise exception 'A real schedule edit did not advance its revision.'; end if;
  select count(*) into v_count from public.advance_reminder_weeks
    where user_id = v_user and week_start in (v_week, v_week - 7) and starts_at = v_next_at;
  if v_count <> 2 then raise exception 'Time-only reschedule postponed an existing daily pay week until the selected weekday.'; end if;
  if not exists (select 1 from public.advance_reminder_deliveries where id = v_sent and status = 'sent' and settings_revision = 1) then raise exception 'Reschedule erased the successful old occurrence.'; end if;
  if not exists (select 1 from public.advance_reminder_deliveries where id = v_sending and status = 'sending' and settings_revision < v_revision) then raise exception 'Reschedule lost the revision guard for an in-flight claim.'; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and settings_revision = 1 and status in ('pending', 'retry')) then raise exception 'Time-only edit retained stale queued deliveries.'; end if;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_user and kind = 'rescheduled' and status = 'pending' and settings_revision = v_revision;
  if v_count <> 2 then raise exception 'Time-only edit did not confirm on exactly the active phones: %', v_count; end if;

  update public.advance_reminder_settings set reminder_time = reminder_time, weekday = weekday where user_id = v_user;
  if not exists (select 1 from public.advance_reminder_settings where user_id = v_user and revision = v_revision and updated_at = v_settings_at) then raise exception 'Unchanged preferences restarted the daily time.'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and starts_at <> v_next_at) then raise exception 'Unchanged preferences moved a pending daily time.'; end if;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_user and kind = 'rescheduled';
  if v_count <> 2 then raise exception 'Unchanged save duplicated reschedule confirmations.'; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 2 then raise exception 'Confirmation claim included a future or stale payment occurrence: %', v_count; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'Repeated scheduler claims duplicated a rescheduled occurrence.'; end if;

  -- An already-passed time waits until tomorrow, without changing Wednesday.
  -- Exact midnight remains the current slot because no past time was selected.
  update public.advance_reminder_settings set reminder_time = '00:00' where user_id = v_user;
  v_expected_start := v_date::timestamp at time zone 'Asia/Kolkata';
  if v_expected_start < now() then v_expected_start := v_expected_start + interval '1 day'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and (starts_at <> v_expected_start or week_start not in (v_week, v_week - 7))) then raise exception 'A past-time edit replayed a slot or changed a pending Wednesday.'; end if;

  -- Disabling cancels queued alerts and leaves the pending identity intact.
  update public.advance_reminder_settings set enabled = false where user_id = v_user;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and status in ('pending', 'retry')) then raise exception 'Disabling retained queued reschedule alerts.'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and starts_at <> v_expected_start) then raise exception 'Disabling moved the pending daily start.'; end if;
  select count(*) into v_count from public.claim_due_advance_reminders(100) where owner_id = v_user;
  if v_count <> 0 then raise exception 'A disabled account claimed notifications.'; end if;

  -- Re-enabling alone restores the daily time but does not send a confirmation.
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_user and kind = 'rescheduled';
  update public.advance_reminder_settings set enabled = true where user_id = v_user;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and starts_at <> v_expected_start) then raise exception 'Re-enabling postponed daily reminders until the selected weekday.'; end if;
  if (select count(*) from public.advance_reminder_deliveries where user_id = v_user and kind = 'rescheduled') <> v_count then raise exception 'Re-enabling without a day/time edit sent a reschedule confirmation.'; end if;
  update public.advance_reminder_settings set weekday = (weekday + 1) % 7 where user_id = v_user;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_user and (starts_at <> v_expected_start or week_start not in (v_week, v_week - 7))) then raise exception 'A weekday-only edit paused a tracked daily pay week.'; end if;

  update public.advance_reminder_settings set reminder_time = v_next_local::time
    where user_id in (v_no_phone, v_completed, v_fresh);
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_no_phone) then raise exception 'A reschedule queued a notification without an active phone.'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_fresh) then raise exception 'A reschedule manufactured a first reminder before the selected weekday.'; end if;
  perform public.claim_due_advance_reminders(100);
  if exists (select 1 from public.advance_reminder_deliveries where user_id in (v_completed, v_fresh) and kind = 'payment') then raise exception 'A completed or not-yet-started pay week received a payment reminder.'; end if;
  if exists (select 1 from public.advance_reminder_weeks where user_id = v_completed) then raise exception 'A completed pay week stayed in daily tracking.'; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_no_phone and status = 'sending') then raise exception 'An account without an active phone claimed a delivery.'; end if;
end;
$$;

-- Isolate exact trigger timestamps from the transaction clock. Only bypass the
-- timestamp-preparation trigger; exercise the real reschedule trigger. All
-- fixture rows and this temporary trigger change are rolled back below.
alter table public.advance_reminder_settings disable trigger advance_reminder_settings_updated;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_phone uuid := gen_random_uuid();
  v_week date := '2026-12-23';
  v_count integer;
begin
  insert into auth.users (id, email) values (v_user, v_user || '@year-end-reschedule.invalid');
  insert into public.advance_reminder_settings (user_id, enabled, weekday, reminder_time, updated_at)
    values (v_user, true, 1, '23:00', '2026-12-31 22:00:00+05:30');
  insert into public.advance_push_subscriptions (id, user_id, endpoint, p256dh, auth, connected_at)
    values (v_phone, v_user, 'https://web.push.apple.com/year-end-reschedule-' || v_user, 'test-key', 'test-auth', '2026-12-31 22:00:00+05:30');
  insert into public.advance_reminder_weeks (user_id, week_start, starts_at)
    values (v_user, v_week, '2026-12-24 23:00:00+05:30');
  insert into public.advance_reminder_deliveries
    (user_id, week_start, subscription_id, endpoint, scheduled_at, status, sent_at)
    values (v_user, v_week, v_phone, 'https://web.push.apple.com/year-end-reschedule-' || v_user,
      '2026-12-31 23:00:00+05:30', 'sent', '2026-12-31 23:00:00+05:30');

  -- Thursday is not the selected Monday. A 23:10 edit after a 23:00 success
  -- still allows this pending week's new 23:30 occurrence on the same day.
  update public.advance_reminder_settings set reminder_time = '23:30', updated_at = '2026-12-31 23:10:00+05:30', revision = 2 where user_id = v_user;
  if not exists (select 1 from public.advance_reminder_weeks where user_id = v_user and week_start = v_week and starts_at = '2026-12-31 23:30:00+05:30') then raise exception '23:00 to 23:30 edit delayed the pending week past today.'; end if;

  update public.advance_reminder_settings set reminder_time = '23:00', updated_at = '2026-12-31 23:31:00+05:30', revision = 3 where user_id = v_user;
  if not exists (select 1 from public.advance_reminder_weeks where user_id = v_user and week_start = v_week and starts_at = '2027-01-01 23:00:00+05:30') then raise exception 'Past-time edit failed daily/year rollover.'; end if;

  update public.advance_reminder_settings set reminder_time = '00:00', updated_at = '2026-12-31 23:59:00+05:30', revision = 4 where user_id = v_user;
  if not exists (select 1 from public.advance_reminder_weeks where user_id = v_user and week_start = v_week and starts_at = '2027-01-01 00:00:00+05:30') then raise exception 'Midnight edit failed daily/year rollover.'; end if;
  if exists (select 1 from public.advance_reminder_deliveries where user_id = v_user and kind = 'rescheduled' and status = 'pending' and settings_revision <> 4) then raise exception 'A later time edit retained stale confirmation revisions.'; end if;

  -- The uniqueness key keeps exact occurrence retries idempotent while allowing
  -- a different daily time or revision after the old successful occurrence.
  insert into public.advance_reminder_deliveries
    (user_id, week_start, subscription_id, endpoint, scheduled_at, kind, settings_revision)
    select user_id, week_start, subscription_id, endpoint, scheduled_at, kind, settings_revision
    from public.advance_reminder_deliveries where user_id = v_user
    on conflict on constraint advance_reminder_delivery_occurrence_key do nothing;
  select count(*) into v_count from public.advance_reminder_deliveries where user_id = v_user;
  if v_count <> 4 then raise exception 'Reschedule occurrence uniqueness no longer protects retries: %', v_count; end if;
end;
$$;

alter table public.advance_reminder_settings enable trigger advance_reminder_settings_updated;
rollback;
