begin;
grant usage on schema public,auth to authenticated,anon,service_role;
-- Broad accidental grants/policies must not expose another account or allow
-- clients to forge a holder, markers or acreage.
grant select,insert,update,delete on public.farm_estate_holder_profiles,public.farm_estate_holder_jobs to authenticated,anon;
create policy holder_test_broad on public.farm_estate_holder_profiles for all to public using(true) with check(true);
create policy holder_jobs_test_broad on public.farm_estate_holder_jobs for all to public using(true) with check(true);
do $$ declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid(); begin
  insert into auth.users(id,email) values(a,a||'@holder-test.invalid'),(b,b||'@holder-test.invalid'),(c,c||'@holder-test.invalid');
  perform set_config('holder.test.a',a::text,true);perform set_config('holder.test.b',b::text,true);perform set_config('holder.test.c',c::text,true);
  if has_function_privilege('authenticated','public.estate_holder_status(uuid)','execute') or has_function_privilege('anon','public.configure_estate_holder(uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.claim_estate_holder_job()','execute') or has_function_privilege('authenticated','public.record_estate_holder_match(uuid,text,jsonb,jsonb)','execute') then raise exception 'Private worker RPC exposed'; end if;
  perform public.configure_estate_holder(a,'Synthetic holder A','{"villageCode":"2301110038","surveyNumber":"72","surnoc":"*","hissaNumber":"4"}');
  perform public.configure_estate_holder(b,'Synthetic holder B','{"villageCode":"2301110012","surveyNumber":"12","surnoc":"*","hissaNumber":"5B"}');
  if public.estate_holder_status(c) is not null then raise exception 'Unconfigured account inherited a holder'; end if;
  if not public.record_estate_holder_match(a,'Synthetic holder A','{"villageCode":"2301110038","surveyNumber":"72","surnoc":"*","hissaNumber":"4"}','{"matches":true,"acres":1.25,"landCode":"synthetic-A"}') then raise exception 'Verified selected record not recorded'; end if;
  if public.record_estate_holder_match(a,'Wrong old holder','{"villageCode":"2301110038","surveyNumber":"73","surnoc":"*","hissaNumber":"4"}','{"matches":true,"acres":999,"landCode":"wrong"}') then raise exception 'Concurrent old profile result was saved'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('holder.test.a'),true);
do $$ declare rejected boolean:=false; begin
  if (select count(*) from public.farm_estate_holder_profiles)<>1 or exists(select 1 from public.farm_estate_holder_profiles where holder_name='Synthetic holder B') then raise exception 'Foreign holder visible'; end if;
  if exists(select 1 from public.farm_estate_holder_jobs where user_id<>auth.uid()) then raise exception 'Foreign holdings/progress visible'; end if;
  update public.farm_estate_holder_profiles set holder_name='Forged';
  if exists(select 1 from public.farm_estate_holder_profiles where holder_name='Forged') then raise exception 'Client changed holder'; end if;
  update public.farm_estate_holder_jobs set matched_acres=9999999;
  if exists(select 1 from public.farm_estate_holder_jobs where matched_acres=9999999) then raise exception 'Client forged acreage'; end if;
  delete from public.farm_estate_holder_profiles;
  if (select count(*) from public.farm_estate_holder_profiles)<>1 then raise exception 'Client deleted holder'; end if;
  begin insert into public.farm_estate_holder_profiles(user_id,holder_name) values(current_setting('holder.test.c')::uuid,'Forged'); exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Client assigned another holder'; end if;
  rejected:=false;begin perform public.estate_holder_status(current_setting('holder.test.b')::uuid);exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Client read foreign status RPC'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin if exists(select 1 from public.farm_estate_holder_profiles) or exists(select 1 from public.farm_estate_holder_jobs) then raise exception 'Anonymous holder/marker disclosure';end if;end $$;
reset role;
do $$ declare j jsonb;rejected boolean:=false; a uuid:=current_setting('holder.test.a')::uuid; begin
  j:=public.claim_estate_holder_job();
  if j is null then raise exception 'Pending verified record not claimed'; end if;
  if public.claim_estate_holder_job() is not null then raise exception 'Overlapping worker lease accepted'; end if;
  if public.finish_estate_holder_job((j->>'id')::bigint,gen_random_uuid(),'{}') then raise exception 'Stale worker token accepted'; end if;
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'{"matches":true,"acres":2.5,"landCode":"synthetic-B"}') then raise exception 'Valid worker result rejected';end if;
  if (public.estate_holder_status(a)->'matches'->0->>'matchedAcres')::numeric<>1.25 then raise exception 'Foreign job changed account total';end if;
  begin perform public.record_estate_holder_match(a,'Synthetic holder A','{"villageCode":"2301110038","surveyNumber":"73","surnoc":"*","hissaNumber":"4"}','{"matches":true,"acres":3,"landCode":"x","ownerName":"sensitive"}');exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Personal content accepted in private references';end if;
  perform public.configure_estate_holder(a,'Synthetic replacement','{"villageCode":"2301110038","surveyNumber":"74","surnoc":"*","hissaNumber":"*"}');
  if jsonb_array_length(public.estate_holder_status(a)->'matches')<>0 then raise exception 'Old holder matches survived selection change';end if;
  update public.farm_estate_holder_jobs set status='working',attempts=3,lease_until=clock_timestamp()-interval '1 second',lease_token=gen_random_uuid() where user_id=a;
  perform public.claim_estate_holder_job();
  if exists(select 1 from public.farm_estate_holder_jobs where user_id=a and status='working' and attempts=3) then raise exception 'Final crashed lease remained stuck';end if;
  delete from auth.users where id=a;
  if exists(select 1 from public.farm_estate_holder_jobs where user_id=a) or exists(select 1 from public.farm_estate_holder_profiles where user_id=a) then raise exception 'Account deletion retained markers';end if;
end $$;
rollback;
