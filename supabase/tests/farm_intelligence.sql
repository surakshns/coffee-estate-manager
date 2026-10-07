-- Owner isolation, atomic profile edits and read-only reference data.
begin;
grant usage on schema public,auth to authenticated,anon;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); profile jsonb; eid uuid; begin
  insert into auth.users(id,email) values(a,a||'@farm-test.invalid'),(b,b||'@farm-test.invalid');
  perform set_config('farm.test.a',a::text,true); perform set_config('farm.test.b',b::text,true);
  profile:='{"estate":{"estate_name":"Test Sakleshpur estate","state":"Karnataka","district":"Hassan","taluk":"Sakleshpur","total_area":12,"cultivated_area":8,"area_unit":"acre","latitude":12.94,"longitude":75.79,"survey_numbers":[]},"blocks":[{"name":"Mixed block","area":8,"area_unit":"acre","crops":[{"crop":"COFFEE","coffee_type":"Arabica","area":8,"area_unit":"acre"},{"crop":"PEPPER","area":8,"area_unit":"acre","is_intercrop":true}]}],"infrastructure":{"water_sources":[],"irrigation":[],"equipment":[],"area_unit":"acre"},"farmer":{"area_unit":"acre"},"insurance":[{"crop":"COFFEE","currently_insured":null},{"crop":"PEPPER","currently_insured":false},{"crop":"ARECANUT","currently_insured":null}],"preferences":[{"kind":"weather_warning","enabled":true,"crops":["COFFEE","PEPPER"]}]}';
  perform set_config('request.jwt.claim.sub',a::text,true);eid:=public.save_farm_profile(profile);
  perform set_config('farm.test.estate',eid::text,true);
  perform set_config('request.jwt.claim.sub',b::text,true);eid:=public.save_farm_profile(profile);
  perform set_config('farm.test.foreign_estate',eid::text,true);
  perform set_config('farm.test.foreign_block',(select id::text from public.farm_blocks where estate_id=eid),true);
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.weather_stations(provider,station_id,station_name,latitude,longitude,active_status,verified,source_url) values
  ('TEST','nearest-unverified','Test unverified',12.94,75.79,true,false,'https://example.invalid/'),
  ('TEST','verified-near','Test verified near',12.95,75.79,true,true,'https://example.invalid/'),
  ('TEST','verified-far','Test verified far',13.2,75.8,true,true,'https://example.invalid/'),
  ('TEST','inactive','Test inactive',12.94,75.79,false,true,'https://example.invalid/');
end $$;
-- A mistakenly broad permissive policy must not expose another farmer's data.
do $$ declare t text;begin
 foreach t in array array['estates','farm_blocks','block_crops','farm_infrastructure','farmer_profiles','insurance_profiles','alert_preferences','estate_alerts'] loop
  execute format('create policy "Farm regression broad access" on public.%I for all to authenticated using(true) with check(true)',t);
 end loop;
end $$;
set local role authenticated;
do $$ declare p jsonb; rejected boolean;begin
  if (select count(*) from public.estates)<>1 or (select count(*) from public.farm_blocks)<>1 or (select count(*) from public.block_crops)<>2
     or (select count(*) from public.insurance_profiles)<>3 or (select count(*) from public.farmer_profiles)<>1
     or (select count(*) from public.farm_infrastructure)<>1 or (select count(*) from public.alert_preferences)<>1 then raise exception 'Foreign farm data is visible.';end if;
  p:=public.get_farm_profile();
  rejected:=false;
  begin perform public.get_farm_profile(current_setting('farm.test.b')::uuid);
  exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Account-change guard exposed a profile for a different expected owner.';end if;
  if exists(select 1 from public.get_nearest_farm_station(current_setting('farm.test.b')::uuid)) then raise exception 'Foreign expected owner selected a station.';end if;
  rejected:=false;
  begin perform public.save_farm_profile(p,current_setting('farm.test.b')::uuid);
  exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Account-change guard accepted a save for a different expected owner.';end if;
  if (select station_id from public.get_nearest_farm_station())<>'verified-near' then raise exception 'Nearest station includes an inactive or unverified station.';end if;
  if p->'insurance'->0->'currently_insured'<>'null'::jsonb or p->'blocks'->0->'crops'->0->'number_of_plants'<>'null'::jsonb then raise exception 'Unknown agricultural values were converted to defaults.';end if;
  -- A selected map location retains its source after an existing-profile edit.
  p:=jsonb_set(p,'{estate,location_source}','{"provider":"KGIS","village_code":"2301110012","survey_number":"12","hissa":null,"surnoc":"*","level":"whole_survey","coordinate_method":"point_inside_polygon","source_url":"https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5/query","retrieved_at":"2026-10-07T00:00:00.000Z"}');
  perform public.save_farm_profile(p);
  if public.get_farm_profile()->'estate'->'location_source' is distinct from p->'estate'->'location_source' then raise exception 'Map provenance was lost on update.';end if;
  rejected:=false;
  begin perform public.save_farm_profile(jsonb_set(p,'{estate,location_source,source_url}','"javascript:alert(1)"'));
  exception when check_violation then rejected:=true;end;
  if not rejected or public.get_farm_profile()->'estate'->'location_source' is distinct from p->'estate'->'location_source' then raise exception 'Invalid provenance accepted or profile was not rolled back.';end if;
  -- Extra owner fields from an untrusted client must be ignored by the RPC.
  p:=jsonb_set(p,'{estate,user_id}',to_jsonb(current_setting('farm.test.b')));
  perform public.save_farm_profile(p);
  if (select user_id from public.estates)<>auth.uid() then raise exception 'RPC allowed owner spoofing.';end if;
  rejected:=false;
  begin perform public.save_farm_profile(jsonb_set(p,'{estate,id}',to_jsonb(current_setting('farm.test.foreign_estate'))));
  exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Foreign estate ID accepted.';end if;
  rejected:=false;
  begin perform public.save_farm_profile(jsonb_set(p,'{blocks,0,id}',to_jsonb(current_setting('farm.test.foreign_block'))));
  exception when unique_violation then rejected:=true;end;
  if not rejected or (select count(*) from public.block_crops)<>2 then raise exception 'Foreign block collision was allowed or edit was not atomic.';end if;
  rejected:=false;
  begin perform public.save_farm_profile(jsonb_set(p,'{blocks,0,area}','20'));
  exception when raise_exception then rejected:=true;end;
  if not rejected or (select area from public.farm_blocks)<>8 then raise exception 'Block area validation or rollback failed.';end if;
  rejected:=false;
  begin insert into public.farm_blocks(estate_id,user_id,name) values(current_setting('farm.test.foreign_estate')::uuid,auth.uid(),'Foreign parent');
  exception when foreign_key_violation then rejected:=true;end;
  if not rejected then raise exception 'Foreign estate child accepted.';end if;
  delete from public.farm_blocks where user_id=current_setting('farm.test.b')::uuid;
  if found then raise exception 'Foreign block deletion allowed.';end if;
  if has_table_privilege('authenticated','public.official_updates','INSERT') or has_table_privilege('authenticated','public.market_prices','UPDATE') or has_table_privilege('authenticated','public.source_fetch_runs','SELECT') then raise exception 'Client can modify reference data or read private fetch logs.';end if;
  if has_function_privilege('authenticated','public.persist_farm_source_batch(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.claim_farm_source(text)','EXECUTE') then raise exception 'Ingestion RPC exposed to clients.';end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.block_crops where user_id=current_setting('farm.test.b')::uuid)<>2 then raise exception 'Foreign crop data changed.';end if;
 if has_table_privilege('anon','public.estates','SELECT') or has_function_privilege('anon','public.get_farm_profile(uuid)','EXECUTE') then raise exception 'Anonymous farm access allowed.';end if;
end $$;
rollback;
