-- Daily reminders for each pending pay week, plus transactional reschedule alerts.
-- Apply after 202610050002_reminder_phone_connections.sql.
begin;

alter table public.advance_reminder_settings add column revision bigint not null default 1;
alter table public.advance_reminder_deliveries
  add column kind text not null default 'payment' check (kind in ('payment', 'rescheduled')),
  add column settings_revision bigint not null default 1;
alter table public.advance_reminder_deliveries
  drop constraint advance_reminder_deliveries_user_id_week_start_endpoint_key,
  add constraint advance_reminder_delivery_occurrence_key unique (user_id, week_start, endpoint, kind, scheduled_at, settings_revision);

-- Retain a week's identity after the next Wednesday. Only weeks whose reminder
-- has actually started are tracked; old missing payments are not backfilled.
create table public.advance_reminder_weeks (
  user_id uuid not null references public.advance_reminder_settings(user_id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 3),
  starts_at timestamptz not null,
  primary key (user_id, week_start)
);
alter table public.advance_reminder_weeks enable row level security;
create policy "Read own pending reminder weeks" on public.advance_reminder_weeks
  for select to authenticated using (user_id = auth.uid());
revoke all on public.advance_reminder_weeks from public, anon, authenticated;
grant select on public.advance_reminder_weeks to authenticated;
grant all on public.advance_reminder_weeks to service_role;
insert into public.advance_reminder_weeks (user_id, week_start, starts_at)
select d.user_id, d.week_start, min(d.scheduled_at)
from public.advance_reminder_deliveries d
join public.advance_reminder_settings s on s.user_id = d.user_id
where not exists (select 1 from public.weekly_pay_runs r where r.user_id = d.user_id and r.week_start = d.week_start)
group by d.user_id, d.week_start;

-- A revision cancels stale in-flight claims even when edits happen in the same
-- transaction. Unchanged saves and connections never restart the schedule.
create function public.prepare_advance_reminder_settings() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.enabled, new.weekday, new.reminder_time, new.timezone)
    is distinct from (old.enabled, old.weekday, old.reminder_time, old.timezone) then
    new.updated_at := now();
    new.revision := old.revision + 1;
  else
    new.updated_at := old.updated_at;
    new.revision := old.revision;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_advance_reminder_settings() from public;
drop trigger advance_reminder_settings_updated on public.advance_reminder_settings;
create trigger advance_reminder_settings_updated before update on public.advance_reminder_settings
  for each row execute function public.prepare_advance_reminder_settings();

create function public.queue_advance_reminder_reschedule() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_local date := (new.updated_at at time zone new.timezone)::date;
  v_start timestamptz;
  v_week date := v_local - ((extract(dow from v_local)::integer + 4) % 7);
begin
  if new.revision = old.revision then return null; end if;
  update public.advance_reminder_deliveries set status = 'cancelled'
    where user_id = new.user_id and status in ('pending', 'retry');
  if not new.enabled then return null; end if;

  -- Rescheduling/re-enabling restarts pending weeks at the next selected day
  -- and time. Their original Wednesday payment dates remain unchanged.
  v_start := (v_local + ((new.weekday - extract(dow from v_local)::integer + 7) % 7) + new.reminder_time) at time zone new.timezone;
  if v_start < new.updated_at then v_start := v_start + interval '7 days'; end if;
  update public.advance_reminder_weeks set starts_at = v_start where user_id = new.user_id;

  if (new.weekday, new.reminder_time) is distinct from (old.weekday, old.reminder_time) then
    insert into public.advance_reminder_deliveries (user_id, week_start, subscription_id, endpoint, scheduled_at, kind, settings_revision)
    select new.user_id, v_week, p.id, p.endpoint, new.updated_at, 'rescheduled', new.revision
    from public.advance_push_subscriptions p
    where p.user_id = new.user_id and p.connected_at <= new.updated_at
      and (p.expiration_time is null or p.expiration_time > new.updated_at)
    on conflict on constraint advance_reminder_delivery_occurrence_key do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.queue_advance_reminder_reschedule() from public;
create trigger advance_reminder_rescheduled after update on public.advance_reminder_settings
  for each row execute function public.queue_advance_reminder_reschedule();

create or replace function public.claim_due_advance_reminders(p_limit integer default 30)
returns table (delivery_id uuid, owner_id uuid, week_start date, subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now();
begin
  update public.advance_reminder_deliveries set status = 'uncertain'
    where status = 'sending' and claimed_at < v_now - interval '5 minutes';
  update public.advance_reminder_deliveries d set status = 'cancelled'
    where d.status in ('pending', 'retry') and (
      not exists (select 1 from public.advance_reminder_settings s where s.user_id = d.user_id and s.enabled and s.revision = d.settings_revision and s.updated_at <= d.scheduled_at)
      or (d.kind = 'payment' and exists (select 1 from public.weekly_pay_runs r where r.user_id = d.user_id and r.week_start = d.week_start))
    );
  update public.advance_reminder_deliveries set status = 'expired'
    where status in ('pending', 'retry') and scheduled_at + interval '1 hour' <= v_now;
  delete from public.advance_reminder_weeks w
    where exists (select 1 from public.weekly_pay_runs r where r.user_id = w.user_id and r.week_start = w.week_start);

  -- Track the selected weekly occurrence even if cron missed its first slot.
  -- Only the latest daily slot may send; no past notification is sent late.
  insert into public.advance_reminder_weeks (user_id, week_start, starts_at)
  select s.user_id, slot.pay_week, slot.due_at
  from public.advance_reminder_settings s
  cross join lateral (
    select (v_now at time zone s.timezone)::date - ((extract(dow from v_now at time zone s.timezone)::integer - s.weekday + 7) % 7) as reminder_date
  ) d
  cross join lateral (
    select (d.reminder_date + s.reminder_time) at time zone s.timezone as due_at,
      d.reminder_date - ((extract(dow from d.reminder_date)::integer + 4) % 7) as pay_week
  ) slot
  where s.enabled and s.updated_at <= slot.due_at and v_now >= slot.due_at
    and not exists (select 1 from public.weekly_pay_runs r where r.user_id = s.user_id and r.week_start = slot.pay_week)
    and exists (select 1 from public.workers w where w.user_id = s.user_id and (w.active or exists (select 1 from public.weekly_payments wp where wp.user_id = s.user_id and wp.worker_id = w.id and wp.week_start = slot.pay_week)))
  on conflict on constraint advance_reminder_weeks_pkey do nothing;

  -- Most recent India-local daily slot (including catch-up across midnight).
  insert into public.advance_reminder_deliveries (user_id, week_start, subscription_id, endpoint, scheduled_at, settings_revision)
  select s.user_id, w.week_start, p.id, p.endpoint, slot.due_at, s.revision
  from public.advance_reminder_settings s
  join public.advance_reminder_weeks w on w.user_id = s.user_id
  cross join lateral (select ((v_now at time zone s.timezone)::date + s.reminder_time) at time zone s.timezone as today_at) t
  cross join lateral (select case when t.today_at > v_now then t.today_at - interval '1 day' else t.today_at end as due_at) slot
  join public.advance_push_subscriptions p on p.user_id = s.user_id
  where s.enabled and s.updated_at <= slot.due_at and w.starts_at <= slot.due_at
    and v_now >= slot.due_at and v_now < slot.due_at + interval '1 hour'
    and p.connected_at <= slot.due_at and (p.expiration_time is null or p.expiration_time > v_now)
    and not exists (select 1 from public.weekly_pay_runs r where r.user_id = s.user_id and r.week_start = w.week_start)
    and exists (select 1 from public.workers worker where worker.user_id = s.user_id and (worker.active or exists (select 1 from public.weekly_payments wp where wp.user_id = s.user_id and wp.worker_id = worker.id and wp.week_start = w.week_start)))
  on conflict on constraint advance_reminder_delivery_occurrence_key do nothing;

  return query
  with candidates as (
    select d.id from public.advance_reminder_deliveries d
    join public.advance_reminder_settings s on s.user_id = d.user_id
    join public.advance_push_subscriptions p on p.id = d.subscription_id and p.user_id = d.user_id
    where d.status in ('pending', 'retry') and d.next_attempt_at <= v_now and d.attempt_count < 3
      and s.enabled and s.revision = d.settings_revision and s.updated_at <= d.scheduled_at
      and d.scheduled_at <= v_now and v_now < d.scheduled_at + interval '1 hour'
      and p.connected_at <= d.scheduled_at and (p.expiration_time is null or p.expiration_time > v_now)
      and (d.kind = 'rescheduled' or (
        not exists (select 1 from public.weekly_pay_runs r where r.user_id = d.user_id and r.week_start = d.week_start)
        and exists (select 1 from public.workers worker where worker.user_id = d.user_id and (worker.active or exists (select 1 from public.weekly_payments wp where wp.user_id = d.user_id and wp.worker_id = worker.id and wp.week_start = d.week_start)))
      ))
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
