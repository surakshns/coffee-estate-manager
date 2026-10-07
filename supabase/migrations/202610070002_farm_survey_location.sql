-- Preserve provenance for a user-selected KGIS planning location. Existing
-- owner-only RLS and atomic account-bound profile saving remain in effect.
alter table public.estates add column location_source jsonb;
alter table public.estates add constraint estates_location_source_valid check (
  location_source is null or coalesce(
    jsonb_typeof(location_source)='object'
    and octet_length(location_source::text)<=2500
    and location_source->>'provider'='KGIS'
    and location_source->>'coordinate_method'='point_inside_polygon'
    and location_source->>'level' in ('whole_survey','hissa')
    and location_source->>'village_code' in ('2301110012','2301110038')
    and location_source->>'survey_number' ~ '^[0-9]{1,6}$'
    and location_source->>'source_url' like 'https://kgis.ksrsac.in/kgismaps2/rest/services/%'
    and length(location_source->>'retrieved_at') between 20 and 40,
    false
  )
);

create or replace function public.save_farm_profile(p_profile jsonb,p_expected_user_id uuid default auth.uid()) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_estate uuid; v_created timestamptz; v_block jsonb; v_crop jsonb; v_item jsonb; v_block_id uuid; v_id uuid; v_total numeric; begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_expected_user_id is distinct from v_user then raise exception 'Your account changed. Reopen the profile before saving.';end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or octet_length(p_profile::text)>200000 then raise exception 'Supply a valid farm profile.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  if jsonb_typeof(p_profile->'estate') <> 'object' or jsonb_typeof(p_profile->'infrastructure') <> 'object' or jsonb_typeof(p_profile->'farmer') <> 'object'
    or jsonb_typeof(p_profile->'blocks') <> 'array' or jsonb_typeof(p_profile->'insurance') <> 'array' or jsonb_typeof(p_profile->'preferences') <> 'array'
    or p_profile->'estate' is null or p_profile->'infrastructure' is null or p_profile->'farmer' is null or p_profile->'blocks' is null or p_profile->'insurance' is null or p_profile->'preferences' is null then raise exception 'Supply all farm profile sections; unknown values may be null.'; end if;
  if jsonb_array_length(p_profile->'blocks')>100 or jsonb_array_length(p_profile->'insurance')>3 or jsonb_array_length(p_profile->'preferences')>18 then raise exception 'Too many farm profile records.'; end if;
  select id,created_at into v_estate,v_created from public.estates where user_id=v_user for update;
  if nullif(p_profile->'estate'->>'id','') is not null and (v_estate is null or (p_profile->'estate'->>'id')::uuid<>v_estate) then raise exception 'Estate does not belong to your account.'; end if;
  v_estate:=coalesce(v_estate,gen_random_uuid()); v_created:=coalesce(v_created,now());
  insert into public.estates select (jsonb_populate_record(null::public.estates,(p_profile->'estate')||jsonb_build_object('id',v_estate,'user_id',v_user,'created_at',v_created,'updated_at',now()))).*
    on conflict (user_id) do update set estate_name=excluded.estate_name,state=excluded.state,district=excluded.district,taluk=excluded.taluk,hobli=excluded.hobli,gram_panchayat=excluded.gram_panchayat,village=excluded.village,pincode=excluded.pincode,latitude=excluded.latitude,longitude=excluded.longitude,total_area=excluded.total_area,area_unit=excluded.area_unit,cultivated_area=excluded.cultivated_area,survey_numbers=excluded.survey_numbers,elevation_m=excluded.elevation_m,location_source=excluded.location_source,updated_at=now();
  delete from public.farm_blocks where estate_id=v_estate;
  for v_block in select value from jsonb_array_elements(p_profile->'blocks') loop
    if jsonb_typeof(v_block) <> 'object' or jsonb_typeof(v_block->'crops') <> 'array' or v_block->'crops' is null or jsonb_array_length(v_block->'crops')>30 then raise exception 'Supply valid block crops.'; end if;
    v_block_id:=coalesce(nullif(v_block->>'id','')::uuid,gen_random_uuid());
    insert into public.farm_blocks select (jsonb_populate_record(null::public.farm_blocks,v_block||jsonb_build_object('id',v_block_id,'estate_id',v_estate,'user_id',v_user,'created_at',now(),'updated_at',now()))).*;
    for v_crop in select value from jsonb_array_elements(v_block->'crops') loop
      if jsonb_typeof(v_crop) <> 'object' then raise exception 'Supply a valid crop record.'; end if;
      v_id:=coalesce(nullif(v_crop->>'id','')::uuid,gen_random_uuid());
      insert into public.block_crops select (jsonb_populate_record(null::public.block_crops,v_crop||jsonb_build_object('id',v_id,'block_id',v_block_id,'estate_id',v_estate,'user_id',v_user,'created_at',now(),'updated_at',now()))).*;
    end loop;
  end loop;
  select sum(case when area_unit='acre' then area*0.40468564224 else area end) into v_total from public.farm_blocks where estate_id=v_estate;
  if exists(select 1 from public.estates e where e.id=v_estate and e.total_area is not null and v_total>case when e.area_unit='acre' then e.total_area*0.40468564224 else e.total_area end) then raise exception 'The physical block areas exceed total estate area. Intercropped crops do not add extra land.'; end if;
  delete from public.farm_infrastructure where estate_id=v_estate;
  insert into public.farm_infrastructure select (jsonb_populate_record(null::public.farm_infrastructure,(p_profile->'infrastructure')||jsonb_build_object('estate_id',v_estate,'user_id',v_user))).*;
  delete from public.farmer_profiles where estate_id=v_estate;
  insert into public.farmer_profiles select (jsonb_populate_record(null::public.farmer_profiles,(p_profile->'farmer')||jsonb_build_object('estate_id',v_estate,'user_id',v_user))).*;
  delete from public.insurance_profiles where estate_id=v_estate;
  for v_item in select value from jsonb_array_elements(p_profile->'insurance') loop
    insert into public.insurance_profiles select (jsonb_populate_record(null::public.insurance_profiles,v_item||jsonb_build_object('id',gen_random_uuid(),'estate_id',v_estate,'user_id',v_user))).*;
  end loop;
  delete from public.alert_preferences where estate_id=v_estate;
  for v_item in select value from jsonb_array_elements(p_profile->'preferences') loop
    insert into public.alert_preferences select (jsonb_populate_record(null::public.alert_preferences,v_item||jsonb_build_object('estate_id',v_estate,'user_id',v_user))).*;
  end loop;
  return v_estate;
end $$;
