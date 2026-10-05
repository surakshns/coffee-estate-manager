-- A phone connected after a reminder slot starts with the next occurrence.
-- Apply after 202610050001_advance_reminders.sql. Existing phones retain their
-- creation timestamp; reconnecting the same subscription preserves this value.
begin;

alter table public.advance_push_subscriptions add column if not exists connected_at timestamptz;
update public.advance_push_subscriptions set connected_at = created_at where connected_at is null;
alter table public.advance_push_subscriptions alter column connected_at set default now();
alter table public.advance_push_subscriptions alter column connected_at set not null;

create or replace function public.claim_due_advance_reminders(p_limit integer default 30)
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
    and p.connected_at <= slot.due_at
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
      and p.connected_at <= d.scheduled_at
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


commit;
