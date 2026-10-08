begin;
grant usage on schema public,auth to authenticated,anon,service_role;
do $$ declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
  insert into auth.users(id,email) values(a,a||'@alias-test.invalid'),(b,b||'@alias-test.invalid');
  perform set_config('alias.test.a',a::text,true);perform set_config('alias.test.b',b::text,true);
  perform public.configure_estate_holder(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"41","surnoc":"*","hissaNumber":"1"}');
  perform public.configure_estate_holder(b,'Synthetic other primary','{"villageCode":"2301110038","surveyNumber":"72","surnoc":"*","hissaNumber":"4"}');
  perform public.record_estate_holder_match(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"41","surnoc":"*","hissaNumber":"1"}','{"matches":true,"acres":1.25,"landCode":"synthetic-existing"}');
  perform public.record_estate_holder_match(b,'Synthetic other primary','{"villageCode":"2301110038","surveyNumber":"72","surnoc":"*","hissaNumber":"4"}','{"matches":false,"acres":null,"landCode":"synthetic-other"}');
  perform public.configure_estate_holder(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"42","surnoc":"*","hissaNumber":"*"}');
end $$;
set local role service_role;
do $$ declare a uuid:=current_setting('alias.test.a')::uuid;j jsonb;s jsonb;rejected boolean:=false;begin
  j:=public.claim_estate_holder_job();
  if j is null or j->>'userId'<>a::text then raise exception 'Expected account-private alias fixture lease';end if;
  if not public.add_estate_holder_alias(a,'Synthetic primary','Synthetic full recorded name') then raise exception 'Could not add exact alias';end if;
  s:=public.estate_holder_status(a);
  if s->>'holderName'<>'Synthetic primary' or s->'holderAliases'<>'["Synthetic full recorded name"]'::jsonb then raise exception 'Alias replaced the primary or did not persist';end if;
  if jsonb_array_length(s->'matches')<>1 or (s->'matches'->0->>'matchedAcres')::numeric<>1.25 then raise exception 'Alias rescan discarded the previous verified acreage';end if;
  if (s->>'pending')::integer<>2 then raise exception 'Alias did not recheck all private records';end if;
  if public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'{"matches":false,"acres":null,"landCode":"stale"}') then raise exception 'Old worker lease wrote after alias addition';end if;
  if public.record_estate_holder_match(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"42","surnoc":"*","hissaNumber":"*"}','{"matches":false,"acres":null,"landCode":"stale"}') then raise exception 'Legacy callback overwrote expanded alias results';end if;
  if public.record_estate_holder_match(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"42","surnoc":"*","hissaNumber":"*"}','{"matches":false,"acres":null,"landCode":"stale"}','{}'::text[]) then raise exception 'Stale alias snapshot was accepted';end if;
  if not public.record_estate_holder_match(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"42","surnoc":"*","hissaNumber":"*"}','{"matches":true,"acres":3.875,"landCode":"synthetic-new"}',array['Synthetic full recorded name']) then raise exception 'Current alias snapshot could not record a match';end if;
  if public.add_estate_holder_alias(a,'Synthetic primary','Synthetic full recorded name') then raise exception 'Repeated alias duplicated or reset the queue';end if;
  if (public.estate_holder_status(a)->>'pending')::integer<>1 then raise exception 'Repeated alias caused another rescan';end if;
  j:=public.claim_estate_holder_job();
  if j->'holderAliases'<>'["Synthetic full recorded name"]'::jsonb then raise exception 'Worker did not receive the private alias snapshot';end if;
  perform public.finish_estate_holder_job((j->>'id')::bigint,(j->>'token')::uuid,'{"matches":true,"acres":1.25,"landCode":"synthetic-existing"}');
  if jsonb_array_length(public.estate_holder_status(a)->'matches')<>2 then raise exception 'Combined names lost or duplicated a matched land reference';end if;
  if public.estate_holder_status(current_setting('alias.test.b')::uuid)->'holderAliases'<>'[]'::jsonb then raise exception 'Another account inherited aliases';end if;
  begin perform public.add_estate_holder_alias(a,'Synthetic primary','<invalid>');exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Invalid alias accepted';end if;
  perform public.configure_estate_holder(a,'Synthetic primary','{"villageCode":"2301110012","surveyNumber":"41","surnoc":"*","hissaNumber":"1"}');
  if public.estate_holder_status(a)->'holderAliases'<>'["Synthetic full recorded name"]'::jsonb then raise exception 'Reusing primary cleared approved aliases';end if;
end $$;
reset role;
-- The existing restrictive policies also protect the new column, even under
-- accidental broad grants and permissive policies.
grant update on public.farm_estate_holder_profiles to authenticated;
create policy alias_test_broad on public.farm_estate_holder_profiles for all to authenticated using(true) with check(true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('alias.test.b'),true);
do $$ declare rejected boolean:=false;begin
  if exists(select 1 from public.farm_estate_holder_profiles where cardinality(holder_aliases)>0) then raise exception 'Foreign alias visible';end if;
  update public.farm_estate_holder_profiles set holder_aliases=array['Forged alias'];
  if exists(select 1 from public.farm_estate_holder_profiles where cardinality(holder_aliases)>0) then raise exception 'Browser forged an alias';end if;
  begin perform public.add_estate_holder_alias(current_setting('alias.test.b')::uuid,'Synthetic other primary','Forged alias');exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Browser invoked alias writer';end if;
  if has_function_privilege('authenticated','public.record_estate_holder_match(uuid,text,jsonb,jsonb,text[])','execute') or has_function_privilege('anon','public.add_estate_holder_alias(uuid,text,text)','execute') then raise exception 'Alias service RPC exposed';end if;
end $$;
reset role;
do $$ declare a uuid:=current_setting('alias.test.a')::uuid;begin
  perform public.configure_estate_holder(a,'Synthetic replacement','{"villageCode":"2301110012","surveyNumber":"43","surnoc":"*","hissaNumber":"*"}');
  if public.estate_holder_status(a)->'holderAliases'<>'[]'::jsonb or jsonb_array_length(public.estate_holder_status(a)->'matches')<>0 then raise exception 'Primary replacement retained previous aliases or matches';end if;
end $$;
rollback;
