-- Keep already-started unpaid weeks on their daily cycle after a schedule edit.
-- Apply after 202610050003_repeating_advance_reminders.sql.
begin;

do $$
begin
  if to_regclass('public.advance_reminder_weeks') is null then
    raise exception 'Apply reminder migration 202610050003_repeating_advance_reminders.sql first, or run supabase/upgrades/advance-reminders.sql to install missing reminder prerequisites and this fix together.';
  end if;
end;
$$;

create or replace function public.queue_advance_reminder_reschedule() returns trigger
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

  -- Tracked weeks have already started repeating. The weekday only determines
  -- the first reminder for new weeks; edits must not pause existing daily ones.
  -- A new time still ahead today can send today, even after the old time sent.
  v_start := (v_local + new.reminder_time) at time zone new.timezone;
  if v_start < new.updated_at then v_start := v_start + interval '1 day'; end if;
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
revoke all on function public.queue_advance_reminder_reschedule() from public, anon, authenticated;

-- Repair pending weeks postponed by the old trigger. Never replay a past slot
-- or restart completed/disabled reminders; delivery tombstones remain intact.
update public.advance_reminder_weeks w
set starts_at = case when slot.today_at < now() then slot.today_at + interval '1 day' else slot.today_at end
from public.advance_reminder_settings s
cross join lateral (
  select ((now() at time zone s.timezone)::date + s.reminder_time) at time zone s.timezone as today_at
) slot
where w.user_id = s.user_id and s.enabled and w.starts_at > now()
  and not exists (select 1 from public.weekly_pay_runs r where r.user_id = w.user_id and r.week_start = w.week_start);

commit;
