-- Server-side abuse control only. No RTC content or owner names are retained.
begin;

create table public.farm_rtc_lookup_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 10)
);

alter table public.farm_rtc_lookup_limits enable row level security;
revoke all on public.farm_rtc_lookup_limits from public, anon, authenticated;
grant all on public.farm_rtc_lookup_limits to service_role;
create policy rtc_lookup_limit_service on public.farm_rtc_lookup_limits
  for all to service_role using (true) with check (true);

create function public.claim_farm_rtc_lookup(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_time timestamptz := clock_timestamp();
  claimed boolean;
begin
  -- The Edge Function supplies the ID returned by Auth.getUser(). Clients
  -- cannot invoke this function or read/modify the per-account counters.
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    return false;
  end if;

  insert into public.farm_rtc_lookup_limits as limits (user_id, window_start, request_count)
  values (p_user_id, request_time, 1)
  on conflict (user_id) do update
    set window_start = case
          when limits.window_start <= request_time - interval '1 minute' then request_time
          else limits.window_start
        end,
        request_count = case
          when limits.window_start <= request_time - interval '1 minute' then 1
          else limits.request_count + 1
        end
    where limits.window_start <= request_time - interval '1 minute'
       or limits.request_count < 10
  returning true into claimed;

  return coalesce(claimed, false);
exception when foreign_key_violation then
  -- An account deleted between the identity check and atomic claim is invalid.
  return false;
end;
$$;

revoke all on function public.claim_farm_rtc_lookup(uuid) from public, anon, authenticated;
grant execute on function public.claim_farm_rtc_lookup(uuid) to service_role;
comment on table public.farm_rtc_lookup_limits is
  'Private per-account minute-window counters for official RTC requests. Contains no records, owners, survey identities or document content.';
comment on function public.claim_farm_rtc_lookup(uuid) is
  'Service-only atomic claim: maximum ten requests per account in each one-minute window.';
notify pgrst, 'reload schema';
commit;
