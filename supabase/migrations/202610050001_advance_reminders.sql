-- Editable advance reminders. No subscriptions or completed weeks are backfilled.
-- Run after 202610040001_remove_joint_loans.sql.
begin;

create table public.advance_reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  weekday smallint not null default 3 check (weekday between 0 and 6),
  reminder_time time(0) not null default '20:00' check (extract(second from reminder_time) = 0),
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  updated_at timestamptz not null default now()
);
create trigger advance_reminder_settings_updated before update on public.advance_reminder_settings
  for each row execute function public.touch_updated_at();

create table public.advance_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 2048),
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create index advance_push_subscriptions_owner on public.advance_push_subscriptions (user_id);
create trigger advance_push_subscriptions_updated before update on public.advance_push_subscriptions
  for each row execute function public.touch_updated_at();

-- A marker certifies an atomic full save, including zero-pay and skipped workers.
-- The worker snapshot does not change when someone joins after the save.
create table public.weekly_pay_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 3),
  completed_at timestamptz not null default now(),
  worker_ids uuid[] not null check (cardinality(worker_ids) > 0),
  primary key (user_id, week_start)
);

-- Keep delivery tombstones when a phone unsubscribes. They prevent another nag
-- for the same account, Wednesday and endpoint after subscribing again.
create table public.advance_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 3),
  endpoint text not null,
  subscription_id uuid references public.advance_push_subscriptions(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'retry', 'uncertain', 'expired', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_http_status integer,
  created_at timestamptz not null default now(),
  unique (user_id, week_start, endpoint)
);
create index advance_reminder_deliveries_pending on public.advance_reminder_deliveries (status, next_attempt_at);

alter table public.advance_reminder_settings enable row level security;
alter table public.advance_push_subscriptions enable row level security;
alter table public.weekly_pay_runs enable row level security;
alter table public.advance_reminder_deliveries enable row level security;
create policy "Read own advance reminder settings" on public.advance_reminder_settings for select to authenticated using (user_id = auth.uid());
create policy "Read own advance push subscriptions" on public.advance_push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "Read own completed pay weeks" on public.weekly_pay_runs for select to authenticated using (user_id = auth.uid());
create policy "Read own advance reminder deliveries" on public.advance_reminder_deliveries for select to authenticated using (user_id = auth.uid());
revoke all on public.advance_reminder_settings, public.advance_push_subscriptions, public.weekly_pay_runs, public.advance_reminder_deliveries from public, anon, authenticated;
grant select on public.advance_reminder_settings, public.advance_push_subscriptions, public.weekly_pay_runs, public.advance_reminder_deliveries to authenticated;
grant all on public.advance_reminder_settings, public.advance_push_subscriptions, public.weekly_pay_runs, public.advance_reminder_deliveries to service_role;

-- Imports/direct record changes invalidate completion; they never manufacture
-- completion from the existence of one (or even several) imported payments.
create function public.invalidate_weekly_pay_run() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP <> 'INSERT' then
    delete from public.weekly_pay_runs where user_id = old.user_id and week_start = old.week_start;
  end if;
  if TG_OP <> 'DELETE' then
    delete from public.weekly_pay_runs where user_id = new.user_id and week_start = new.week_start;
  end if;
  return null;
end;
$$;
revoke all on function public.invalidate_weekly_pay_run() from public;
create trigger weekly_pay_run_invalidated after insert or update or delete on public.weekly_payments
  for each row execute function public.invalidate_weekly_pay_run();

-- Explicit ownership checks are preserved. SECURITY DEFINER allows the marker
-- write without granting clients a way to mark an imported/partial week done.
create or replace function public.save_weekly_labour(p_week_start date, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_row record;
  v_old public.weekly_payments%rowtype;
  v_gross numeric;
  v_rate numeric;
  v_balance numeric;
  v_worker_ids uuid[];
begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 3 then raise exception 'Choose a Wednesday payment date.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No worker payments supplied.'; end if;
  if (select count(distinct row->>'worker_id') from jsonb_array_elements(p_rows) row) <> jsonb_array_length(p_rows) then raise exception 'Each worker must appear once.'; end if;
  perform id from public.workers where user_id = v_user order by id for update;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    where not exists (select 1 from public.workers w where w.id = (row->>'worker_id')::uuid and w.user_id = v_user)
  ) then raise exception 'Worker does not belong to your account.'; end if;
  select array_agg((row->>'worker_id')::uuid order by row->>'worker_id') into v_worker_ids from jsonb_array_elements(p_rows) row;
  delete from public.worker_loans where user_id = v_user and loan_date = p_week_start and kind = 'repayment'
    and notes = 'Repayment recorded with weekly payment' and worker_id = any(v_worker_ids);
  for v_row in select * from jsonb_to_recordset(p_rows) as x(worker_id uuid, days_worked numeric, daily_rate numeric, excluded boolean, personal_deduction numeric) loop
    select * into v_old from public.weekly_payments where user_id = v_user and worker_id = v_row.worker_id and week_start = p_week_start;
    if v_row.days_worked is null or v_row.days_worked < 0 or v_row.days_worked > 7
      or ((v_row.days_worked > 6 or v_row.days_worked <> trunc(v_row.days_worked))
        and v_row.days_worked is distinct from coalesce(v_old.days_worked, round(v_old.amount / nullif(coalesce(v_old.daily_rate, v_row.daily_rate), 0), 1))) then
      raise exception 'Choose working days from 0 to 6.';
    end if;
    v_rate := coalesce(v_old.daily_rate, v_row.daily_rate);
    if v_rate is null or v_rate < 0 or v_rate > 9999999999.99 then raise exception 'Enter a valid daily rate.'; end if;
    v_gross := round(v_row.days_worked * v_rate, 2);
    if v_old.id is not null and v_row.days_worked = coalesce(v_old.days_worked, round(v_old.amount / nullif(v_rate, 0), 1)) then v_gross := v_old.amount; end if;
    if v_row.excluded then v_gross := 0; v_row.days_worked := 0; v_row.personal_deduction := 0; end if;
    if v_row.personal_deduction is null or v_row.personal_deduction < 0 or v_row.personal_deduction > v_gross then raise exception 'Loan deductions must be between zero and the weekly wage.'; end if;
    if v_row.personal_deduction > 0 then
      select coalesce(sum(case when kind = 'advance' then amount else -amount end), 0) into v_balance from public.worker_loans where user_id = v_user and worker_id = v_row.worker_id;
      if v_row.personal_deduction > v_balance then raise exception 'Deduction exceeds the worker’s loan balance.'; end if;
      insert into public.worker_loans (user_id, worker_id, loan_date, amount, kind, notes) values (v_user, v_row.worker_id, p_week_start, v_row.personal_deduction, 'repayment', 'Repayment recorded with weekly payment');
    end if;
    insert into public.weekly_payments (user_id, worker_id, week_start, amount, excluded, days_worked, daily_rate, loan_deduction)
      values (v_user, v_row.worker_id, p_week_start, v_gross, coalesce(v_row.excluded, false), v_row.days_worked, v_rate, v_row.personal_deduction)
      on conflict (worker_id, week_start) do update set amount = excluded.amount, excluded = excluded.excluded,
        days_worked = excluded.days_worked, daily_rate = excluded.daily_rate, loan_deduction = excluded.loan_deduction;
  end loop;
  -- Partial saves retain their existing payment behaviour, but are not complete.
  if not exists (
    select 1 from public.workers w where w.user_id = v_user
      and (w.active or exists (select 1 from public.weekly_payments p where p.user_id = v_user and p.worker_id = w.id and p.week_start = p_week_start))
      and not (w.id = any(v_worker_ids))
  ) then
    insert into public.weekly_pay_runs (user_id, week_start, worker_ids) values (v_user, p_week_start, v_worker_ids)
      on conflict (user_id, week_start) do update set worker_ids = excluded.worker_ids, completed_at = now();
  end if;
end;
$$;
revoke all on function public.save_weekly_labour(date, jsonb) from public;
grant execute on function public.save_weekly_labour(date, jsonb) to authenticated;

create or replace function public.clear_weekly_labour(p_week_start date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 3 then raise exception 'Choose a Wednesday payment date.'; end if;
  perform id from public.workers where user_id = v_user order by id for update;
  delete from public.worker_loans where user_id = v_user and loan_date = p_week_start and kind = 'repayment' and notes = 'Repayment recorded with weekly payment';
  delete from public.weekly_payments where user_id = v_user and week_start = p_week_start;
  delete from public.weekly_pay_runs where user_id = v_user and week_start = p_week_start;
end;
$$;
revoke all on function public.clear_weekly_labour(date) from public;
grant execute on function public.clear_weekly_labour(date) to authenticated;

-- Service-only atomic enqueue and claim. One run per account/Wednesday/device,
-- with a one-hour catch-up window. Edits/enables after a slot never send it late.
create function public.claim_due_advance_reminders(p_limit integer default 30)
returns table (delivery_id uuid, owner_id uuid, week_start date, subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now();
begin
  -- A crash/network ambiguity cannot safely be retried: the push may already
  -- have been accepted. Keep it uncertain rather than sending a duplicate.
  update public.advance_reminder_deliveries set status = 'uncertain'
    where status = 'sending' and claimed_at < v_now - interval '5 minutes';
  update public.advance_reminder_deliveries d set status = 'cancelled'
    where d.status in ('pending', 'retry') and (
      not exists (select 1 from public.advance_reminder_settings s where s.user_id = d.user_id and s.enabled and s.updated_at <= d.scheduled_at)
      or exists (select 1 from public.weekly_pay_runs r where r.user_id = d.user_id and r.week_start = d.week_start)
    );
  update public.advance_reminder_deliveries set status = 'expired'
    where status in ('pending', 'retry') and scheduled_at + interval '1 hour' <= v_now;
  insert into public.advance_reminder_deliveries (user_id, week_start, subscription_id, endpoint, scheduled_at)
  select s.user_id, slot.pay_week, p.id, p.endpoint, slot.due_at
  from public.advance_reminder_settings s
  cross join lateral (
    select (v_now at time zone s.timezone)::date - ((extract(dow from v_now at time zone s.timezone)::integer - s.weekday + 7) % 7) as reminder_date
  ) d
  cross join lateral (
    select (d.reminder_date + s.reminder_time) at time zone s.timezone as due_at,
      d.reminder_date - ((extract(dow from d.reminder_date)::integer + 4) % 7) as pay_week
  ) slot
  join public.advance_push_subscriptions p on p.user_id = s.user_id
  where s.enabled and s.updated_at <= slot.due_at and v_now >= slot.due_at and v_now < slot.due_at + interval '1 hour'
    and (p.expiration_time is null or p.expiration_time > v_now)
    and not exists (select 1 from public.weekly_pay_runs r where r.user_id = s.user_id and r.week_start = slot.pay_week)
    and exists (select 1 from public.workers w where w.user_id = s.user_id and (w.active or exists (select 1 from public.weekly_payments wp where wp.user_id = s.user_id and wp.worker_id = w.id and wp.week_start = slot.pay_week)))
  on conflict on constraint advance_reminder_deliveries_user_id_week_start_endpoint_key do nothing;

  return query
  with candidates as (
    select d.id from public.advance_reminder_deliveries d
    join public.advance_reminder_settings s on s.user_id = d.user_id
    join public.advance_push_subscriptions p on p.id = d.subscription_id and p.user_id = d.user_id
    where d.status in ('pending', 'retry') and d.next_attempt_at <= v_now and d.attempt_count < 3
      and s.enabled and s.updated_at <= d.scheduled_at and v_now < d.scheduled_at + interval '1 hour'
      and (p.expiration_time is null or p.expiration_time > v_now)
      and not exists (select 1 from public.weekly_pay_runs r where r.user_id = d.user_id and r.week_start = d.week_start)
    order by d.scheduled_at, d.id limit least(greatest(p_limit, 1), 100)
    for update of d skip locked
  ), claimed as (
    update public.advance_reminder_deliveries d set status = 'sending', claimed_at = v_now, attempt_count = d.attempt_count + 1
      from candidates c where d.id = c.id returning d.*
  )
  select d.id, d.user_id, d.week_start, p.id, p.endpoint, p.p256dh, p.auth
    from claimed d join public.advance_push_subscriptions p on p.id = d.subscription_id and p.user_id = d.user_id;
end;
$$;
revoke all on function public.claim_due_advance_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_advance_reminders(integer) to service_role;

create function public.finish_advance_reminder(p_id uuid, p_status text, p_http_status integer default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent', 'retry', 'uncertain', 'expired', 'cancelled') then raise exception 'Invalid delivery result.'; end if;
  update public.advance_reminder_deliveries set
    status = case when p_status = 'retry' and (attempt_count >= 3 or now() + interval '5 minutes' >= scheduled_at + interval '1 hour') then 'expired' else p_status end,
    next_attempt_at = now() + interval '5 minutes',
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    last_http_status = p_http_status
  where id = p_id and status = 'sending';
end;
$$;
revoke all on function public.finish_advance_reminder(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.finish_advance_reminder(uuid, text, integer) to service_role;

-- Explicit test alerts are separate from the scheduled ledger and rate limited.
create function public.claim_advance_reminder_test(p_user_id uuid, p_endpoint text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  update public.advance_push_subscriptions set last_test_at = now()
    where user_id = p_user_id and endpoint = p_endpoint and (last_test_at is null or last_test_at < now() - interval '1 minute')
    returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.claim_advance_reminder_test(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_advance_reminder_test(uuid, text) to service_role;

commit;
