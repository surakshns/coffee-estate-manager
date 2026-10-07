begin;
grant usage on schema public, auth to authenticated, anon;
insert into public.farm_survey_maps(village_code,layer,geojson,source_url,retrieved_at) values
('2301110012','whole_survey','{"type":"FeatureCollection","features":[]}',
 'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5/query?f=geojson',now());

do $$ begin
  if not (select relrowsecurity from pg_class where oid='public.farm_survey_maps'::regclass) then raise exception 'Survey cache RLS disabled.'; end if;
  if has_table_privilege('anon','public.farm_survey_maps','SELECT') then raise exception 'Anonymous survey cache access.'; end if;
  if has_table_privilege('authenticated','public.farm_survey_maps','INSERT')
    or has_table_privilege('authenticated','public.farm_survey_maps','UPDATE')
    or has_table_privilege('authenticated','public.farm_survey_maps','DELETE')
    or has_table_privilege('authenticated','public.farm_survey_maps','TRUNCATE') then raise exception 'User can replace verified map data.'; end if;
  if not has_table_privilege('service_role','public.farm_survey_maps','INSERT') then raise exception 'Server cannot refresh map.'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
  if (select count(*) from public.farm_survey_maps) <> 1 then raise exception 'Signed-in user cannot read reference geometry.'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from public.farm_survey_maps) then raise exception 'Missing user identity bypasses policy.'; end if;
end $$;
reset role;

do $$ declare rejected boolean:=false; begin
  begin update public.farm_survey_maps set village_code='untrusted';
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Unsupported village accepted.'; end if;
  rejected:=false;
  begin update public.farm_survey_maps set source_url='https://evil.invalid/';
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Unofficial map source accepted.'; end if;
end $$;
rollback;
