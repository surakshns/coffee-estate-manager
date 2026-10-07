-- Farm profiles are private. Published reference data is read-only to clients.
begin;

create function public.farm_nonnegative(value numeric) returns boolean language sql immutable
  set search_path = public, pg_temp as $$ select value is null or (value >= 0 and value < 'Infinity'::numeric) $$;

create table public.estates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade unique,
  estate_name text check (char_length(estate_name) <= 160),
  state text not null default 'Karnataka' check (char_length(state) between 1 and 100),
  district text not null default 'Hassan' check (char_length(district) between 1 and 100),
  taluk text not null default 'Sakleshpur' check (char_length(taluk) between 1 and 100),
  hobli text, gram_panchayat text, village text,
  pincode text check (pincode ~ '^[0-9]{6}$'),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  total_area numeric check (public.farm_nonnegative(total_area)),
  area_unit text not null default 'acre' check (area_unit in ('acre','hectare')),
  cultivated_area numeric check (public.farm_nonnegative(cultivated_area) and (total_area is null or cultivated_area <= total_area)),
  survey_numbers text[] not null default '{}' check (cardinality(survey_numbers) <= 50),
  elevation_m numeric check (elevation_m between -500 and 9000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id,user_id), check ((latitude is null) = (longitude is null)),
  check (char_length(coalesce(hobli,'') || coalesce(gram_panchayat,'') || coalesce(village,'')) <= 500)
);
create table public.farm_blocks (
  id uuid primary key default gen_random_uuid(), estate_id uuid not null, user_id uuid not null default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  area numeric check (public.farm_nonnegative(area)), area_unit text not null default 'acre' check (area_unit in ('acre','hectare')),
  latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180),
  irrigation_type text, water_source text, notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id,estate_id,user_id), foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade,
  check ((latitude is null) = (longitude is null))
);
create table public.block_crops (
  id uuid primary key default gen_random_uuid(), block_id uuid not null, estate_id uuid not null, user_id uuid not null default auth.uid(),
  crop text not null check (crop in ('COFFEE','PEPPER','ARECANUT')),
  coffee_type text check (coffee_type in ('Arabica','Robusta')),
  variety text check (char_length(variety) <= 160),
  area numeric check (public.farm_nonnegative(area)), area_unit text not null default 'acre' check (area_unit in ('acre','hectare')),
  planting_year integer check (planting_year between 1800 and 2200), age_years numeric check (age_years between 0 and 300),
  number_of_plants integer check (number_of_plants >= 0), bearing_plants integer check (bearing_plants >= 0), non_bearing_plants integer check (non_bearing_plants >= 0),
  bearing_area numeric check (public.farm_nonnegative(bearing_area)), non_bearing_area numeric check (public.farm_nonnegative(non_bearing_area)),
  processing_type text check (processing_type in ('cherry','parchment','both')),
  support_tree_type text check (char_length(support_tree_type) <= 160),
  estimated_annual_production numeric check (public.farm_nonnegative(estimated_annual_production)),
  production_unit text check (char_length(production_unit) <= 40), is_intercrop boolean,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (block_id,estate_id,user_id) references public.farm_blocks(id,estate_id,user_id) on delete cascade,
  check (crop = 'COFFEE' or (coffee_type is null and processing_type is null)),
  check (number_of_plants is null or coalesce(bearing_plants,0) + coalesce(non_bearing_plants,0) <= number_of_plants),
  check (area is null or coalesce(bearing_area,0) + coalesce(non_bearing_area,0) <= area)
);
create table public.farm_infrastructure (
  estate_id uuid primary key, user_id uuid not null default auth.uid(),
  water_sources text[] not null default '{}', irrigation text[] not null default '{}', equipment text[] not null default '{}',
  irrigated_area numeric check (public.farm_nonnegative(irrigated_area)), rainfed_area numeric check (public.farm_nonnegative(rainfed_area)),
  area_unit text not null default 'acre' check (area_unit in ('acre','hectare')),
  water_storage_capacity_l numeric check (public.farm_nonnegative(water_storage_capacity_l)), pump_hp numeric check (public.farm_nonnegative(pump_hp)),
  summer_water_shortage boolean, foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade,
  check (cardinality(water_sources) <= 12 and cardinality(irrigation) <= 12 and cardinality(equipment) <= 50)
);
create table public.farmer_profiles (
  estate_id uuid primary key, user_id uuid not null default auth.uid(),
  farmer_type text check (farmer_type in ('individual','partnership','company','FPO','cooperative','other')),
  total_agricultural_landholding numeric check (public.farm_nonnegative(total_agricultural_landholding)),
  area_unit text not null default 'acre' check (area_unit in ('acre','hectare')),
  coffee_board_grower_id_available boolean, fpo_member boolean, cooperative_member boolean,
  government_registration_status text check (char_length(government_registration_status) <= 500),
  foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade
);
create table public.insurance_profiles (
  id uuid primary key default gen_random_uuid(), estate_id uuid not null, user_id uuid not null default auth.uid(),
  crop text not null check (crop in ('COFFEE','PEPPER','ARECANUT')), currently_insured boolean,
  scheme_name text, insurer text, policy_year text check (char_length(policy_year) <= 20), season text check (char_length(season) <= 80),
  sum_insured numeric check (public.farm_nonnegative(sum_insured)), premium_paid numeric check (public.farm_nonnegative(premium_paid)),
  weather_station_name text, weather_station_id text,
  unique (estate_id,crop), foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade,
  check (char_length(coalesce(scheme_name,'') || coalesce(insurer,'') || coalesce(weather_station_name,'') || coalesce(weather_station_id,'')) <= 1000)
);
create table public.alert_preferences (
  estate_id uuid not null, user_id uuid not null default auth.uid(), kind text not null,
  enabled boolean not null default true, crops text[] not null default array['COFFEE','PEPPER','ARECANUT'],
  primary key (estate_id,kind), foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade,
  check (crops <@ array['COFFEE','PEPPER','ARECANUT']::text[]),
  check (kind in ('government_schemes','subsidy_deadlines','insurance_enrollment','insurance_updates','heavy_rainfall','drought','weather_warning','pest_risk','disease_risk','spray_weather','coffee_prices','pepper_prices','arecanut_prices','coffee_board_updates','spices_board_updates','local_news','training_events','disaster_relief'))
);

create table public.data_sources (
  id text primary key, source_name text not null, source_url text not null check (source_url ~ '^https://'),
  source_type text not null check (source_type in ('official','authoritative','verified_media','other','model')),
  source_authority_level smallint not null check (source_authority_level between 1 and 4),
  enabled boolean not null default false,
  status text not null check (status in ('ready','manual_review','unavailable','credentials_required','permission_required')),
  status_message text not null, min_interval_minutes integer not null check (min_interval_minutes >= 180),
  last_success_at timestamptz, last_checked_at timestamptz, lease_until timestamptz
);
create table public.source_fetch_runs (
  id uuid primary key default gen_random_uuid(), source_id text not null references public.data_sources(id),
  started_at timestamptz not null default now(), finished_at timestamptz, http_status integer,
  records_found integer not null default 0, records_inserted integer not null default 0, records_updated integer not null default 0,
  parse_errors integer not null default 0, error_message text, content_hash text, source_changed boolean
);
create table public.official_updates (
  id uuid primary key default gen_random_uuid(), source_id text not null references public.data_sources(id),
  source_name text not null, source_url text not null check (source_url ~ '^https://'),
  source_type text not null check (source_type in ('official','authoritative','verified_media','other','model')),
  source_authority_level smallint not null check (source_authority_level between 1 and 4),
  retrieved_at timestamptz not null, source_published_at text, source_updated_at text,
  effective_from text, effective_until text, financial_year text, season text, raw_source_reference text not null,
  verification_status text not null check (verification_status in ('OFFICIAL_CONFIRMED','OFFICIAL_BUT_OLD','SECONDARY_CONFIRMED','UNVERIFIED','EXPIRED')),
  title text not null check (char_length(title) between 1 and 500), summary text not null check (char_length(summary) <= 2000),
  category text not null check (category in ('schemes','insurance','weather','pest','prices','government','news','training','relief')),
  crops text[] not null default '{}' check (crops <@ array['COFFEE','PEPPER','ARECANUT']::text[]),
  state text, district text, taluk text, village text, application_deadline text, application_url text,
  dedupe_key text not null check (dedupe_key ~ '^[a-f0-9]{64}$'), details jsonb not null default '{}',
  unique (source_id,dedupe_key)
);
create table public.market_prices (
  id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id) on delete cascade unique,
  source_id text not null references public.data_sources(id), crop text not null check (crop in ('COFFEE','PEPPER','ARECANUT')),
  variety text, grade text, market text not null, district text, state text,
  min_price numeric check (public.farm_nonnegative(min_price)), max_price numeric check (public.farm_nonnegative(max_price)),
  modal_price numeric check (public.farm_nonnegative(modal_price)), average_price numeric check (public.farm_nonnegative(average_price)),
  unit text not null, price_date date not null, price_kind text not null check (price_kind in ('indicative','international_indicator','futures','mandi')),
  source_url text not null check (source_url ~ '^https://'), retrieved_at timestamptz not null,
  check (min_price is null or max_price is null or min_price <= max_price)
);
-- Structured component/reference rows inherit complete provenance from update_id.
create table public.schemes (
  id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id) unique,
  name text not null, component text, financial_year text, authority text, assistance_type text,
  min_land numeric, max_land numeric, subsidy_percentage numeric check (subsidy_percentage between 0 and 100),
  max_amount numeric check (public.farm_nonnegative(max_amount)), eligible_equipment text[] not null default '{}',
  eligibility_rules jsonb not null default '{}', required_documents jsonb not null default '[]',
  source_document text, source_page integer check (source_page > 0), rules_verified boolean not null default false
);
create table public.scheme_crop_mapping (scheme_id uuid references public.schemes(id) on delete cascade, crop text check (crop in ('COFFEE','PEPPER','ARECANUT')), primary key (scheme_id,crop));
create table public.scheme_location_mapping (id uuid primary key default gen_random_uuid(), scheme_id uuid not null references public.schemes(id) on delete cascade, state text, district text, taluk text, village text);
create table public.weather_stations (
  id uuid primary key default gen_random_uuid(), provider text not null, station_id text not null, station_name text not null,
  latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180),
  gram_panchayat text, hobli text, taluk text, district text, station_type text,
  active_status boolean not null default false, verified boolean not null default false, source_url text not null,
  unique (provider,station_id), check (not verified or (latitude is not null and longitude is not null))
);
create table public.rainfall_observations (
  id uuid primary key default gen_random_uuid(), station_id uuid not null references public.weather_stations(id),
  observed_at timestamptz not null, period_start timestamptz not null, period_end timestamptz not null,
  rainfall_mm numeric check (public.farm_nonnegative(rainfall_mm)), source_url text not null,
  retrieved_at timestamptz not null, quality_status text not null check (quality_status in ('verified','provisional','missing','revised','invalid')),
  unique (station_id,period_start,period_end), check (period_start < period_end)
);
create table public.weather_forecasts (
  id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id) unique,
  forecast_date date not null, district text not null, warning_colour text, warning_text text not null,
  precipitation_mm numeric check (public.farm_nonnegative(precipitation_mm)), temperature_c numeric, humidity_percent numeric check (humidity_percent between 0 and 100), wind_kmh numeric check (public.farm_nonnegative(wind_kmh))
);
create table public.agromet_advisories (id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id) unique, district text not null, crop text, advisory_type text, source_page integer, review_verified boolean not null default false);
create table public.insurance_terms (
  id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id),
  scheme text not null, terms_version text not null, year text not null, season text not null, crop text not null check (crop in ('COFFEE','PEPPER','ARECANUT')),
  state text not null, district text not null, taluk text, insurance_unit text not null, insurer text,
  sum_insured numeric check (public.farm_nonnegative(sum_insured)), farmer_premium numeric check (public.farm_nonnegative(farmer_premium)),
  trigger_type text, trigger_start date, trigger_end date, payout_formula jsonb, source_document text, source_page integer,
  verified_at timestamptz, verification_status text not null default 'UNVERIFIED' check (verification_status in ('OFFICIAL_CONFIRMED','OFFICIAL_BUT_OLD','UNVERIFIED','EXPIRED')),
  unique (scheme,terms_version,year,season,crop,insurance_unit), check (verification_status <> 'OFFICIAL_CONFIRMED' or (verified_at is not null and payout_formula is not null and insurer is not null and source_page is not null and source_page > 0))
);
create table public.insurance_weather_mapping (
  id uuid primary key default gen_random_uuid(), terms_id uuid not null references public.insurance_terms(id),
  reference_weather_station uuid not null references public.weather_stations(id), backup_weather_station uuid references public.weather_stations(id),
  source_notification text not null, source_page integer, verified boolean not null default false, unique (terms_id)
);
create table public.news_articles (id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id) unique, normalized_url text not null, content_hash text, media_verified boolean not null default false);
create table public.crop_risk_alerts (id uuid primary key default gen_random_uuid(), update_id uuid not null references public.official_updates(id), advisory_id uuid not null references public.agromet_advisories(id), forecast_id uuid not null references public.weather_forecasts(id), crop text not null, risk_name text not null, conditions jsonb not null, review_verified boolean not null default false);
create table public.estate_alerts (id uuid primary key default gen_random_uuid(), estate_id uuid not null, user_id uuid not null default auth.uid(), update_id uuid not null references public.official_updates(id), read_at timestamptz, created_at timestamptz not null default now(), unique (estate_id,update_id), foreign key (estate_id,user_id) references public.estates(id,user_id) on delete cascade);

create index farm_blocks_estate on public.farm_blocks(estate_id);
create index block_crops_crop on public.block_crops(crop,estate_id);
create index official_updates_location on public.official_updates(state,district,taluk);
create index official_updates_publication on public.official_updates(source_published_at desc);
create index official_updates_deadlines on public.official_updates(application_deadline);
create index official_updates_crops on public.official_updates using gin(crops);
create index market_prices_crop_date on public.market_prices(crop,price_date desc);
create index rainfall_station_time on public.rainfall_observations(station_id,observed_at desc);
create index source_fetch_runs_source_time on public.source_fetch_runs(source_id,started_at desc);
create index insurance_terms_location_period on public.insurance_terms(state,district,taluk,year,season,crop);

do $$ declare table_name text; begin
  foreach table_name in array array['estates','farm_blocks','block_crops','farm_infrastructure','farmer_profiles','insurance_profiles','alert_preferences','estate_alerts'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
    execute format('create policy "Own farm records" on public.%I for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid())',table_name);
    execute format('create policy "Farm owner guard" on public.%I as restrictive for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid())',table_name);
  end loop;
  foreach table_name in array array['data_sources','official_updates','market_prices','schemes','scheme_crop_mapping','scheme_location_mapping','weather_stations','rainfall_observations','weather_forecasts','agromet_advisories','insurance_terms','insurance_weather_mapping','news_articles','crop_risk_alerts'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
    execute format('create policy "Read farm reference data" on public.%I for select to authenticated using (true)',table_name);
  end loop;
end $$;
alter table public.source_fetch_runs enable row level security;
revoke all on public.source_fetch_runs from public,anon,authenticated;
grant all on public.source_fetch_runs to service_role;

create function public.get_farm_profile(p_expected_user_id uuid default auth.uid()) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_estate public.estates%rowtype; begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  if p_expected_user_id is distinct from auth.uid() then raise exception 'Your account changed. Reopen the profile.';end if;
  select * into v_estate from public.estates where user_id=auth.uid();
  if v_estate.id is null then return null; end if;
  return jsonb_build_object(
    'estate',to_jsonb(v_estate),
    'blocks',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('crops',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.block_crops c where c.block_id=b.id),'[]'::jsonb)) order by b.created_at,b.id) from public.farm_blocks b where b.estate_id=v_estate.id),'[]'::jsonb),
    'infrastructure',(select to_jsonb(i) from public.farm_infrastructure i where i.estate_id=v_estate.id),
    'farmer',(select to_jsonb(f) from public.farmer_profiles f where f.estate_id=v_estate.id),
    'insurance',coalesce((select jsonb_agg(to_jsonb(p) order by p.crop) from public.insurance_profiles p where p.estate_id=v_estate.id),'[]'::jsonb),
    'preferences',coalesce((select jsonb_agg(to_jsonb(p) order by p.kind) from public.alert_preferences p where p.estate_id=v_estate.id),'[]'::jsonb)
  );
end $$;

create function public.save_farm_profile(p_profile jsonb,p_expected_user_id uuid default auth.uid()) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
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
    on conflict (user_id) do update set estate_name=excluded.estate_name,state=excluded.state,district=excluded.district,taluk=excluded.taluk,hobli=excluded.hobli,gram_panchayat=excluded.gram_panchayat,village=excluded.village,pincode=excluded.pincode,latitude=excluded.latitude,longitude=excluded.longitude,total_area=excluded.total_area,area_unit=excluded.area_unit,cultivated_area=excluded.cultivated_area,survey_numbers=excluded.survey_numbers,elevation_m=excluded.elevation_m,updated_at=now();
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
revoke all on function public.get_farm_profile(uuid),public.save_farm_profile(jsonb,uuid) from public,anon;
grant execute on function public.get_farm_profile(uuid),public.save_farm_profile(jsonb,uuid) to authenticated;

-- Rank the complete connected station dataset in PostgreSQL. A truncated
-- browser result set must never be presented as the nearest official station.
create function public.get_nearest_farm_station(p_expected_user_id uuid default auth.uid()) returns setof public.weather_stations
language sql stable security invoker set search_path=public,pg_temp as $$
 select w.* from public.weather_stations w join public.estates e on e.user_id=auth.uid()
 where e.user_id=p_expected_user_id and w.verified and w.active_status and e.latitude is not null and e.longitude is not null
 order by power(sin(radians((w.latitude-e.latitude)/2)),2)
   +cos(radians(e.latitude))*cos(radians(w.latitude))*power(sin(radians((w.longitude-e.longitude)/2)),2)
 limit 1;
$$;
revoke all on function public.get_nearest_farm_station(uuid) from public,anon;
grant execute on function public.get_nearest_farm_station(uuid) to authenticated;

create function public.claim_farm_source(p_source_id text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id text; begin
  update public.data_sources set lease_until=now()+interval '2 minutes',last_checked_at=now()
  where id=p_source_id and enabled and status='ready' and (lease_until is null or lease_until<now())
    and (last_checked_at is null or last_checked_at+make_interval(mins=>min_interval_minutes)<=now()) returning id into v_id;
  return v_id is not null;
end $$;
create function public.finish_farm_source(p_source_id text,p_success boolean) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.data_sources set lease_until=null,last_success_at=case when p_success then now() else last_success_at end where id=p_source_id;
$$;
revoke all on function public.claim_farm_source(text),public.finish_farm_source(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_farm_source(text),public.finish_farm_source(text,boolean) to service_role;

insert into public.data_sources(id,source_name,source_url,source_type,source_authority_level,enabled,status,status_message,min_interval_minutes) values
 ('coffee-board-news','Coffee Board of India','https://coffeeboard.gov.in/News.aspx','official',1,true,'ready','Public grower notice metadata; individual scheme rules require review.',720),
 ('coffee-board-market','Coffee Board of India','https://coffeeboard.gov.in/','official',1,true,'ready','International indicators with their own quote dates, not estate selling rates.',720),
 ('coffee-board-schemes','Coffee Board scheme documents','https://coffeeboard.gov.in/15th-comission.html','official',1,false,'manual_review','Index mixes historical guidelines with component notices; current estate subsidy rules need review.',1440),
 ('spices-board-prices','Spices Board India','https://www.indianspices.com/marketing/price/domestic/current-market-price','official',1,true,'ready','Validated Cochin indicative pepper averages in INR/kg with original quote dates.',720),
 ('spices-board-programmes','Spices Board programmes','https://www.indianspices.com/box5_programmes_schemes.html','official',1,false,'manual_review','Published September 2026 deadlines are past; current continuation and component rules need review.',720),
 ('imd-hassan-warning','India Meteorological Department','https://mausam.imd.gov.in/imd_latest/contents/districtwise-warning_mc.php?id=13&day=Day_2','official',1,true,'ready','Official district warning; not estate observations.',360),
 ('imd-authenticated-api','IMD documented API','https://api.imd.gov.in/public/api_reference.html','official',1,false,'credentials_required','Tested endpoints require an API key; temperature, humidity, wind and numeric forecasts are not ingested.',360),
 ('imd-agromet','IMD Bengaluru Agromet','https://mausam.imd.gov.in/bengaluru/mcdata/agromete.pdf','official',1,false,'manual_review','PDF accessible; district/crop/page extraction needs review before ingestion.',1440),
 ('dasd-updates','Directorate of Arecanut and Spices Development','https://dasd.kerala.gov.in/action-plan-2026-27/','official',1,false,'manual_review','Current institutional action plan, not individual subsidy entitlement.',1440),
 ('karnataka-horticulture','Karnataka Horticulture','https://horticulturedir.karnataka.gov.in/en','official',1,false,'permission_required','Source links available; republication permission and component rules need verification.',1440),
 ('hassan-updates','Hassan District Administration','https://hassan.nic.in/en/notice_category/announcements/','official',1,false,'manual_review','No current estate-crop notices verified; old beneficiary lists are excluded.',1440),
 ('ksndmc-observed','KSNDMC','https://ksndmc.org/en/DailyReport/getDailyReport','official',1,false,'unavailable','Official Karnataka station observations unavailable; approved validated access required.',1440),
 ('arecanut-agmarknet','AGMARKNET / data.gov.in','https://agmarknet.gov.in/','official',1,false,'unavailable','Official metadata works; no relevant numeric arecanut price response verified.',1440),
 ('karnataka-insurance','Karnataka crop insurance notifications','https://slbckarnataka.com/UserFiles/slbc/PMFBY%20and%20RWBCIS%202026-27.zip','official',1,false,'manual_review','Archive retrieved; crop/unit/season/insurer/station/term sheet mapping unverified.',1440);

-- Persist one validated fetch atomically. A bad price/forecast cannot publish a
-- partly successful batch; earlier valid records remain intact on rollback.
create function public.persist_farm_source_batch(p_source_id text,p_batch jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.data_sources%rowtype; item jsonb; v_id uuid; v_existing uuid; inserted integer:=0; updated integer:=0; begin
  select * into s from public.data_sources where id=p_source_id and enabled and status='ready';
  if s.id is null then raise exception 'Source is not enabled.'; end if;
  if p_batch is null or jsonb_typeof(p_batch->'updates') is distinct from 'array' or jsonb_typeof(p_batch->'prices') is distinct from 'array'
     or jsonb_typeof(p_batch->'forecasts') is distinct from 'array' or octet_length(p_batch::text)>2000000
     or jsonb_array_length(p_batch->'updates')>500 then raise exception 'Invalid source batch.'; end if;
  for item in select value from jsonb_array_elements(p_batch->'updates') loop
    if item->>'source_id' is distinct from s.id then raise exception 'Source mismatch.'; end if;
    select id into v_existing from public.official_updates where source_id=s.id and dedupe_key=item->>'dedupe_key';
    v_id:=coalesce(v_existing,gen_random_uuid());
    insert into public.official_updates select (jsonb_populate_record(null::public.official_updates,item||jsonb_build_object('id',v_id,'source_id',s.id,'source_name',s.source_name,'source_type',s.source_type,'source_authority_level',s.source_authority_level))).*
    on conflict (source_id,dedupe_key) do update set source_url=excluded.source_url,retrieved_at=excluded.retrieved_at,source_published_at=excluded.source_published_at,source_updated_at=excluded.source_updated_at,effective_from=excluded.effective_from,effective_until=excluded.effective_until,financial_year=excluded.financial_year,season=excluded.season,raw_source_reference=excluded.raw_source_reference,verification_status=excluded.verification_status,title=excluded.title,summary=excluded.summary,category=excluded.category,crops=excluded.crops,state=excluded.state,district=excluded.district,taluk=excluded.taluk,village=excluded.village,application_deadline=excluded.application_deadline,application_url=excluded.application_url,details=excluded.details;
    if v_existing is null then inserted:=inserted+1; else updated:=updated+1; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_batch->'prices') loop
    if item->>'source_id' is distinct from s.id then raise exception 'Price source mismatch.'; end if;
    select id into v_id from public.official_updates where source_id=s.id and dedupe_key=item->>'update_key';
    if v_id is null or not exists(select 1 from jsonb_array_elements(p_batch->'updates') u where u->>'dedupe_key'=item->>'update_key') then raise exception 'Price has no update in this batch.'; end if;
    insert into public.market_prices select (jsonb_populate_record(null::public.market_prices,item||jsonb_build_object('id',gen_random_uuid(),'update_id',v_id))).*
    on conflict (update_id) do update set min_price=excluded.min_price,max_price=excluded.max_price,modal_price=excluded.modal_price,average_price=excluded.average_price,retrieved_at=excluded.retrieved_at,price_date=excluded.price_date,unit=excluded.unit;
  end loop;
  for item in select value from jsonb_array_elements(p_batch->'forecasts') loop
    select id into v_id from public.official_updates where source_id=s.id and dedupe_key=item->>'update_key';
    if v_id is null or not exists(select 1 from jsonb_array_elements(p_batch->'updates') u where u->>'dedupe_key'=item->>'update_key') then raise exception 'Forecast has no update in this batch.'; end if;
    insert into public.weather_forecasts(id,update_id,forecast_date,district,warning_colour,warning_text)
      values(gen_random_uuid(),v_id,(item->>'forecast_date')::date,item->>'district',item->>'warning_colour',item->>'warning_text')
    on conflict (update_id) do update set warning_colour=excluded.warning_colour,warning_text=excluded.warning_text;
  end loop;
  return jsonb_build_object('inserted',inserted,'updated',updated);
end $$;
revoke all on function public.persist_farm_source_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_farm_source_batch(text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
