-- The server can claim at most ten requests; client roles cannot inspect or
-- manipulate counters or choose a different authenticated user's limit.
begin;
grant usage on schema public to service_role, authenticated, anon;

do $$ declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); begin
  insert into auth.users(id,email) values (a,a||'@rtc-limit-test.invalid'),(b,b||'@rtc-limit-test.invalid');
  perform set_config('farm.rtc.test.a',a::text,true);
  perform set_config('farm.rtc.test.b',b::text,true);
  if not (select relrowsecurity from pg_class where oid='public.farm_rtc_lookup_limits'::regclass) then raise exception 'RTC limit RLS disabled.'; end if;
  if has_table_privilege('anon','public.farm_rtc_lookup_limits','SELECT')
    or has_table_privilege('authenticated','public.farm_rtc_lookup_limits','SELECT')
    or has_table_privilege('authenticated','public.farm_rtc_lookup_limits','INSERT')
    or has_table_privilege('authenticated','public.farm_rtc_lookup_limits','UPDATE')
    or has_table_privilege('authenticated','public.farm_rtc_lookup_limits','DELETE')
    or has_table_privilege('authenticated','public.farm_rtc_lookup_limits','TRUNCATE') then raise exception 'Client can inspect or replace RTC counters.'; end if;
  if has_function_privilege('anon','public.claim_farm_rtc_lookup(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_farm_rtc_lookup(uuid)','EXECUTE') then raise exception 'RTC rate-limit claim exposed to clients.'; end if;
  if not has_function_privilege('service_role','public.claim_farm_rtc_lookup(uuid)','EXECUTE') then raise exception 'Server cannot claim RTC lookup.'; end if;
  if not (select prosecdef and 'search_path=pg_catalog, public'=any(proconfig) from pg_proc where oid='public.claim_farm_rtc_lookup(uuid)'::regprocedure) then raise exception 'RTC claim is not a fixed-search-path security definer.'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('farm.rtc.test.a'),true);
do $$ declare rejected boolean := false; begin
  begin perform public.claim_farm_rtc_lookup(current_setting('farm.rtc.test.b')::uuid);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Authenticated user could claim another account limit.'; end if;
end $$;
reset role;

set local role service_role;
do $$ declare a uuid := current_setting('farm.rtc.test.a')::uuid; b uuid := current_setting('farm.rtc.test.b')::uuid; i integer; initial_window timestamptz; begin
  if public.claim_farm_rtc_lookup(null) or public.claim_farm_rtc_lookup(gen_random_uuid()) then raise exception 'Invalid identity consumed a claim.'; end if;
  if exists (select 1 from public.farm_rtc_lookup_limits) then raise exception 'Invalid identity created a counter.'; end if;
  for i in 1..10 loop
    if not public.claim_farm_rtc_lookup(a) then raise exception 'Valid claim % rejected.',i; end if;
  end loop;
  select window_start into initial_window from public.farm_rtc_lookup_limits where user_id=a;
  if public.claim_farm_rtc_lookup(a) or public.claim_farm_rtc_lookup(a) then raise exception 'More than ten requests accepted inside a minute.'; end if;
  if (select request_count from public.farm_rtc_lookup_limits where user_id=a) <> 10
    or (select window_start from public.farm_rtc_lookup_limits where user_id=a) <> initial_window then raise exception 'Rejected requests modified the limit window.'; end if;
  if not public.claim_farm_rtc_lookup(b) then raise exception 'One account exhausted another account limit.'; end if;
  update public.farm_rtc_lookup_limits set window_start=clock_timestamp()-interval '61 seconds' where user_id=a;
  if not public.claim_farm_rtc_lookup(a) then raise exception 'Expired window did not reset.'; end if;
  if (select request_count from public.farm_rtc_lookup_limits where user_id=a) <> 1
    or (select window_start from public.farm_rtc_lookup_limits where user_id=a) <= initial_window-interval '1 second' then raise exception 'Reset retained an expired count/window.'; end if;
end $$;
reset role;

do $$ declare rejected boolean := false; a uuid := current_setting('farm.rtc.test.a')::uuid; begin
  begin update public.farm_rtc_lookup_limits set request_count=11 where user_id=a;
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Counter accepted more than ten.'; end if;
  delete from auth.users where id=a;
  if exists(select 1 from public.farm_rtc_lookup_limits where user_id=a) then raise exception 'Deleted account retained a rate-limit row.'; end if;
end $$;
rollback;
