begin;
grant usage on schema public to authenticated,service_role;
-- Synthetic public geometry inventories. Repeated fragments of a survey must
-- produce one options job; Hissa geometry must not replace RTC enumeration.
insert into public.farm_survey_maps(village_code,layer,geojson,source_url,retrieved_at) values
  ('2301110012','whole_survey','{"type":"FeatureCollection","features":[{"properties":{"surveynumberi":10}},{"properties":{"surveynumberi":10}},{"properties":{"surveynumberi":11}},{"properties":{"surveynumberi":0}}]}',
   'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5/query?f=geojson',now()),
  ('2301110038','whole_survey','{"type":"FeatureCollection","features":[{"properties":{"surveynumberi":20}}]}',
   'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5/query?f=geojson',now()),
  ('2301110012','hissa','{"type":"FeatureCollection","features":[{"properties":{"surveynumberi":12}}]}',
   'https://kgis.ksrsac.in/kgismaps2/rest/services/HissaData/Hissadata_Edgematched/MapServer/1/query?f=geojson',now())
  on conflict(village_code,layer) do update set geojson=excluded.geojson,source_url=excluded.source_url,retrieved_at=excluded.retrieved_at;
do $$ declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();begin
  insert into auth.users(id,email) values(a,a||'@queue-test.invalid'),(b,b||'@queue-test.invalid'),(c,c||'@queue-test.invalid');
  perform set_config('queue.test.a',a::text,true);perform set_config('queue.test.b',b::text,true);perform set_config('queue.test.c',c::text,true);
end $$;

-- Exercise the service-only API under its actual granted role. The functions
-- run as their fixed-search-path definer; no browser ID/name is accepted here.
set local role service_role;
do $$ declare a uuid:=current_setting('queue.test.a')::uuid;b uuid:=current_setting('queue.test.b')::uuid;
  anchor_a jsonb:='{"villageCode":"2301110012","surveyNumber":"10","surnoc":"*","hissaNumber":"1"}';
  anchor_b jsonb:='{"villageCode":"2301110038","surveyNumber":"20","surnoc":"*","hissaNumber":"2"}';s jsonb;begin
  perform public.configure_estate_holder(a,'Synthetic queue holder A',anchor_a);
  perform public.configure_estate_holder(a,'Synthetic queue holder A',anchor_a);
  perform public.configure_estate_holder(b,'Synthetic queue holder B',anchor_b);
  s:=public.estate_holder_status(a);
  if (s->>'surveysTotal')::integer<>3 or (s->>'pending')::integer<>4 then raise exception 'Survey inventory or unchanged configuration duplicated jobs';end if;
  if (public.estate_holder_status(b)->>'surveysTotal')::integer<>3 then raise exception 'A separate account did not receive its own survey inventory';end if;
  if public.estate_holder_status(current_setting('queue.test.c')::uuid) is not null then raise exception 'An unconfigured account inherited another holder';end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.farm_estate_holder_jobs where user_id=current_setting('queue.test.a')::uuid)<>4
    or exists(select 1 from public.farm_estate_holder_jobs where user_id=current_setting('queue.test.a')::uuid and survey_number in ('0','12')) then raise exception 'Invalid or Hissa-only survey entered inventory';end if;
end $$;

set local role service_role;
do $$ declare j jsonb;before_status jsonb;rejected boolean;invalid jsonb;n integer;begin
  j:=public.claim_estate_holder_job();
  if j is null or j->>'kind'<>'record' or j->>'userId'<>current_setting('queue.test.a') then raise exception 'Selected anchor was not prioritised';end if;
  if public.claim_estate_holder_job() is not null then raise exception 'Parallel global lease accepted';end if;
  if public.finish_estate_holder_job((j->>'id')::bigint,gen_random_uuid(),'{"matches":true,"acres":999,"landCode":"forged"}') then raise exception 'Wrong lease token accepted';end if;
  for invalid in select value from jsonb_array_elements('[{"acres":1,"landCode":"missing-boolean"},{"matches":true,"acres":1,"landCode":"x","ownerName":"private"},{"matches":"true","acres":1,"landCode":"x"},[]]') loop
    rejected:=false;
    begin perform public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,invalid);exception when others then rejected:=true;end;
    if not rejected then raise exception 'Invalid record-result shape was accepted';end if;
  end loop;
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'{"matches":true,"acres":1.25,"landCode":"queue-anchor-A"}') then raise exception 'Valid selected record could not complete';end if;
  j:=public.claim_estate_holder_job();
  if j is null or j->>'kind'<>'options' or j->'identity'->>'surveyNumber'<>'10' then raise exception 'Expected first exact survey options job';end if;
  before_status:=public.estate_holder_status(current_setting('queue.test.a')::uuid);
  rejected:=false;
  begin
    -- The first insert must roll back when a later entry contains personal data.
    perform public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,
      '[{"surnoc":"*","hissaNumber":"9"},{"surnoc":"*","hissaNumber":"8","ownerName":"private"}]');
  exception when others then rejected:=true;end;
  if not rejected or public.estate_holder_status(current_setting('queue.test.a')::uuid) is distinct from before_status then raise exception 'Invalid options partially inserted jobs';end if;
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,
    '[{"surnoc":"*","hissaNumber":"1"},{"surnoc":"*","hissaNumber":"1"},{"surnoc":"*","hissaNumber":"1A"},{"surnoc":"A","hissaNumber":"*"}]') then raise exception 'Valid compound and whole RTC identifiers rejected';end if;
  if (public.estate_holder_status(current_setting('queue.test.a')::uuid)->>'recordsChecked')::integer<>1
    or (public.estate_holder_status(current_setting('queue.test.a')::uuid)->>'pending')::integer<>4 then raise exception 'Options duplicated the completed anchor or repeated Hissa';end if;
  -- Two additional completed actions bring the shared publisher budget to four.
  for n in 1..2 loop
    j:=public.claim_estate_holder_job();
    if j is null or j->>'kind'<>'options' then raise exception 'Expected another pending survey options job';end if;
    if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'[]') then raise exception 'Verified empty RTC options could not complete';end if;
  end loop;
  if public.claim_estate_holder_job() is not null then raise exception 'More than four global actions allowed inside a minute';end if;
  if (public.estate_holder_status(current_setting('queue.test.b')::uuid)->>'pending')::integer<>4 then raise exception 'Another account bypassed or consumed the shared four-action budget';end if;
  -- Clearing an account's prior jobs must not clear shared publisher history.
  perform public.configure_estate_holder(current_setting('queue.test.b')::uuid,'Synthetic changed holder B','{"villageCode":"2301110038","surveyNumber":"20","surnoc":"*","hissaNumber":"2"}');
  if public.claim_estate_holder_job() is not null then raise exception 'Changing a holder erased the global four-action limit';end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.farm_estate_holder_jobs where user_id=current_setting('queue.test.a')::uuid and kind='record')<>3 then raise exception 'RTC options were not deduplicated';end if;
  if not exists(select 1 from public.farm_estate_holder_jobs where user_id=current_setting('queue.test.a')::uuid and hissa_number='1A' and surnoc='*')
    or not exists(select 1 from public.farm_estate_holder_jobs where user_id=current_setting('queue.test.a')::uuid and hissa_number='*' and surnoc='A') then raise exception 'Official compound identifiers were lost';end if;
  -- Simulate passage of the minute window without relying on the wall clock.
  update public.farm_estate_holder_worker_limit set window_start=clock_timestamp()-interval '2 minutes';
  update public.farm_estate_holder_jobs set last_started_at=clock_timestamp()-interval '2 minutes',next_run_at=clock_timestamp()+interval '1 day' where user_id in(current_setting('queue.test.a')::uuid,current_setting('queue.test.b')::uuid);
  update public.farm_estate_holder_jobs set next_run_at=clock_timestamp()-interval '1 second' where user_id=current_setting('queue.test.b')::uuid and kind='record';
end $$;

-- Backoff/retry semantics, including recovery of a stale worker token.
set local role service_role;
do $$ declare j jsonb;begin
  j:=public.claim_estate_holder_job();
  if j is null or j->>'userId'<>current_setting('queue.test.b') then raise exception 'Due retry fixture could not claim';end if;
  perform set_config('queue.test.old_job',j::text,true);
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,null) then raise exception 'Failed first attempt did not reschedule';end if;
  if public.claim_estate_holder_job() is not null then raise exception 'Failed first attempt ignored retry backoff';end if;
end $$;
reset role;
do $$ declare j jsonb:=current_setting('queue.test.old_job')::jsonb;begin
  if not exists(select 1 from public.farm_estate_holder_jobs where id=(j->>'id')::bigint and status='pending' and attempts=1 and next_run_at>=clock_timestamp()+interval '14 minutes' and lease_token is null) then raise exception 'First attempt does not have bounded 15-minute backoff';end if;
  if (select request_count from public.farm_estate_holder_worker_limit where singleton)<>1 then raise exception 'An empty due queue consumed the global publisher budget';end if;
  update public.farm_estate_holder_jobs set next_run_at=clock_timestamp()-interval '1 second',last_started_at=clock_timestamp()-interval '2 minutes' where id=(j->>'id')::bigint;
end $$;
set local role service_role;
do $$ declare old_job jsonb:=current_setting('queue.test.old_job')::jsonb;j jsonb;begin
  j:=public.claim_estate_holder_job();
  if j is null or j->>'id'<>old_job->>'id' or j->>'token'=old_job->>'token' then raise exception 'Retry did not receive a new lease';end if;
  if public.finish_estate_holder_job((old_job->>'id')::bigint,(old_job->>'token')::uuid,'{"matches":true,"acres":999,"landCode":"stale"}') then raise exception 'Earlier worker completed a new lease';end if;
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,null) then raise exception 'Failed second attempt did not reschedule';end if;
end $$;
reset role;
do $$ declare j jsonb:=current_setting('queue.test.old_job')::jsonb;begin
  if not exists(select 1 from public.farm_estate_holder_jobs where id=(j->>'id')::bigint and status='pending' and attempts=2 and next_run_at>=clock_timestamp()+interval '29 minutes') then raise exception 'Second attempt does not have bounded 30-minute backoff';end if;
  update public.farm_estate_holder_jobs set next_run_at=clock_timestamp()-interval '1 second',last_started_at=clock_timestamp()-interval '2 minutes' where id=(j->>'id')::bigint;
end $$;
set local role service_role;
do $$ declare j jsonb;begin
  j:=public.claim_estate_holder_job();
  if j is null then raise exception 'Third allowed attempt could not claim';end if;
  if not public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,null) then raise exception 'Failed third attempt did not settle';end if;
  if public.claim_estate_holder_job() is not null then raise exception 'Exhausted attempt remained immediately claimable';end if;
end $$;
reset role;
do $$ declare j jsonb:=current_setting('queue.test.old_job')::jsonb;begin
  if not exists(select 1 from public.farm_estate_holder_jobs where id=(j->>'id')::bigint and status='unavailable' and attempts=3 and lease_token is null and lease_until is null) then raise exception 'Exhausted attempts did not become unavailable';end if;
  update public.farm_estate_holder_jobs set last_started_at=clock_timestamp()-interval '2 minutes';
  update public.farm_estate_holder_jobs set next_run_at=clock_timestamp()-interval '1 second' where user_id=current_setting('queue.test.a')::uuid and kind='record' and hissa_number='1A';
end $$;

set local role service_role;
do $$ declare j jsonb;a uuid:=current_setting('queue.test.a')::uuid;begin
  j:=public.claim_estate_holder_job();
  if j is null or j->>'userId'<>a::text then raise exception 'Old holder job could not claim before replacement';end if;
  perform public.configure_estate_holder(a,'Synthetic replacement holder','{"villageCode":"2301110012","surveyNumber":"11","surnoc":"*","hissaNumber":"5B"}');
  if public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'{"matches":true,"acres":999,"landCode":"old-holder"}') then raise exception 'Stale worker committed after a holder change';end if;
  if public.record_estate_holder_match(a,'Synthetic queue holder A','{"villageCode":"2301110012","surveyNumber":"10","surnoc":"*","hissaNumber":"1"}','{"matches":true,"acres":999,"landCode":"old-holder"}') then raise exception 'Old selected lookup committed after a holder change';end if;
  if jsonb_array_length(public.estate_holder_status(a)->'matches')<>0 then raise exception 'Previous holder records remained visible';end if;
  if public.claim_estate_holder_job() is not null then raise exception 'Holder replacement reset the shared minute counter';end if;
  if public.estate_holder_status(current_setting('queue.test.c')::uuid) is not null then raise exception 'Unconfigured account inherited the replacement profile';end if;
end $$;
reset role;

-- Browser reads are account-scoped; the third account remains unconfigured.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('queue.test.c'),true);
do $$ declare rejected boolean:=false;begin
  if exists(select 1 from public.farm_estate_holder_profiles) or exists(select 1 from public.farm_estate_holder_jobs) then raise exception 'Unconfigured browser account saw another holder or queue';end if;
  begin perform public.estate_holder_status(current_setting('queue.test.a')::uuid);exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Browser called service-only foreign-status RPC';end if;
end $$;
reset role;
rollback;
