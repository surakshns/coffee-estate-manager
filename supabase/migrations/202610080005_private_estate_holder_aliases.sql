-- Explicitly approved RTC name variants belong to one private holder profile.
-- Keep existing matches visible while checking all records against the expanded
-- exact-name set. No global substring or family-name matching is introduced.
begin;

create function public.valid_estate_holder_aliases(names text[]) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select names is not null and coalesce(array_ndims(names),1)=1 and cardinality(names)<=10
    and not exists(select 1 from unnest(names) name where name is null or length(btrim(name)) not between 1 and 100 or name ~ '[[:cntrl:]<>]');
$$;
alter table public.farm_estate_holder_profiles add column holder_aliases text[] not null default '{}'
  check (public.valid_estate_holder_aliases(holder_aliases));

-- A previous verified result remains visible, with its actual checked_at, until
-- a fresh result completes. Pending coverage still prevents a final acreage.
do $$ declare constraint_name text; begin
  select conname into strict constraint_name from pg_constraint
    where conrelid='public.farm_estate_holder_jobs'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%matched IS NULL%' and pg_get_constraintdef(oid) like '%status%';
  execute format('alter table public.farm_estate_holder_jobs drop constraint %I',constraint_name);
end $$;
alter table public.farm_estate_holder_jobs add constraint estate_holder_verified_snapshot
  check (matched is null or (kind='record' and checked_at is not null));

-- Service-only: call after verifying the user-approved exact alias in a live
-- RTC. Adding an alias never replaces the primary name or touches other users.
create function public.add_estate_holder_alias(p_user_id uuid,p_holder_name text,p_alias text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare aliases text[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,817360822));
  select holder_aliases into aliases from public.farm_estate_holder_profiles where user_id=p_user_id and holder_name=p_holder_name for update;
  if not found then raise exception 'Holder profile does not match'; end if;
  if not public.valid_estate_holder_aliases(array[p_alias]) then raise exception 'Invalid recorded alias'; end if;
  p_alias:=btrim(p_alias);
  if p_alias=p_holder_name or p_alias=any(aliases) then return false; end if;
  if cardinality(aliases)>=10 then raise exception 'Too many recorded aliases'; end if;
  update public.farm_estate_holder_profiles set holder_aliases=array_append(aliases,p_alias) where user_id=p_user_id;
  -- Invalidate outstanding leases and retry already checked records, preserving
  -- verified snapshots. Options jobs are independent of the name set.
  update public.farm_estate_holder_jobs set status='pending',attempts=0,next_run_at=clock_timestamp(),lease_until=null,lease_token=null
    where user_id=p_user_id and kind='record';
  return true;
end $$;

create or replace function public.configure_estate_holder(p_user_id uuid,p_holder_name text,p_anchor jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous_name text; v text; s text; sn text; h text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,817360822));
  if p_anchor is null or jsonb_typeof(p_anchor)<>'object' or p_anchor-array['villageCode','surveyNumber','surnoc','hissaNumber']<>'{}'::jsonb then raise exception 'Invalid holder anchor'; end if;
  v:=p_anchor->>'villageCode'; s:=p_anchor->>'surveyNumber'; sn:=p_anchor->>'surnoc'; h:=p_anchor->>'hissaNumber';
  if v not in ('2301110012','2301110038') or s!~'^[1-9][0-9]{0,5}$' or sn!~'^[A-Za-z0-9*./_-]{1,20}$' or h!~'^[A-Za-z0-9*./_-]{1,20}$' or v is null or s is null or sn is null or h is null then raise exception 'Invalid holder anchor'; end if;
  select holder_name into previous_name from public.farm_estate_holder_profiles where user_id=p_user_id for update;
  insert into public.farm_estate_holder_profiles(user_id,holder_name) values(p_user_id,p_holder_name)
    on conflict(user_id) do update set holder_aliases=case when farm_estate_holder_profiles.holder_name<>excluded.holder_name then '{}'::text[] else farm_estate_holder_profiles.holder_aliases end,holder_name=excluded.holder_name,configured_at=case when farm_estate_holder_profiles.holder_name<>excluded.holder_name then now() else farm_estate_holder_profiles.configured_at end;
  if previous_name is distinct from p_holder_name then delete from public.farm_estate_holder_jobs where user_id=p_user_id; end if;
  -- Prioritise the verified selected parcel, then enumerate every mapped survey's
  -- official RTC options, including records with no published Hissa geometry.
  insert into public.farm_estate_holder_jobs(user_id,kind,village_code,survey_number,surnoc,hissa_number)
    values(p_user_id,'record',v,s,sn,h) on conflict do nothing;
  insert into public.farm_estate_holder_jobs(user_id,kind,village_code,survey_number)
    select p_user_id,'options',m.village_code,f->'properties'->>'surveynumberi'
    from public.farm_survey_maps m cross join lateral jsonb_array_elements(m.geojson->'features') f
    where m.layer='whole_survey' and (f->'properties'->>'surveynumberi')~'^[1-9][0-9]{0,5}$'
    order by m.village_code,(f->'properties'->>'surveynumberi')::integer on conflict do nothing;
end $$;

create or replace function public.claim_estate_holder_job() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.farm_estate_holder_jobs; token uuid:=gen_random_uuid();
begin
  if not pg_try_advisory_xact_lock(817360821) then return null; end if;
  update public.farm_estate_holder_jobs set status='unavailable',lease_until=null,lease_token=null where status='working' and lease_until<=clock_timestamp() and attempts>=3;
  if exists(select 1 from public.farm_estate_holder_jobs where status='working' and lease_until>clock_timestamp()) then return null; end if;
  insert into public.farm_estate_holder_worker_limit(singleton,window_start,request_count) values(true,clock_timestamp(),0) on conflict do nothing;
  update public.farm_estate_holder_worker_limit set window_start=clock_timestamp(),request_count=0 where window_start<=clock_timestamp()-interval '1 minute';
  if (select request_count from public.farm_estate_holder_worker_limit where singleton)>=4 then return null; end if;
  select * into j from public.farm_estate_holder_jobs where
    ((status='pending' and next_run_at<=clock_timestamp()) or (status='working' and lease_until<=clock_timestamp()))
    and attempts<3 order by id for update skip locked limit 1;
  if j.id is null then return null; end if;
  update public.farm_estate_holder_worker_limit set request_count=request_count+1 where singleton;
  update public.farm_estate_holder_jobs set status='working',attempts=attempts+1,last_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds',lease_token=token where id=j.id;
  return jsonb_build_object('id',j.id,'token',token,'userId',j.user_id,'holderName',(select holder_name from public.farm_estate_holder_profiles where user_id=j.user_id),'holderAliases',(select holder_aliases from public.farm_estate_holder_profiles where user_id=j.user_id),'kind',j.kind,'identity',jsonb_build_object('villageCode',j.village_code,'surveyNumber',j.survey_number,'surnoc',j.surnoc,'hissaNumber',j.hissa_number));
end $$;

create or replace function public.record_estate_holder_match(p_user_id uuid,p_holder_name text,p_identity jsonb,p_result jsonb,p_holder_aliases text[])
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,817360822));
  if not exists(select 1 from public.farm_estate_holder_profiles where user_id=p_user_id and holder_name=p_holder_name and holder_aliases=p_holder_aliases) then return false; end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_identity-array['villageCode','surveyNumber','surnoc','hissaNumber']<>'{}'::jsonb
    or p_result is null or jsonb_typeof(p_result)<>'object' or p_result-array['matches','acres','landCode']<>'{}'::jsonb or not coalesce(jsonb_typeof(p_result->'matches')='boolean',false) then raise exception 'Invalid match reference'; end if;
  insert into public.farm_estate_holder_jobs(user_id,kind,village_code,survey_number,surnoc,hissa_number,status,checked_at,matched,matched_acres,land_code)
    values(p_user_id,'record',p_identity->>'villageCode',p_identity->>'surveyNumber',p_identity->>'surnoc',p_identity->>'hissaNumber','complete',clock_timestamp(),(p_result->>'matches')::boolean,case when (p_result->>'matches')::boolean then (p_result->>'acres')::numeric else null end,p_result->>'landCode')
    on conflict(user_id,kind,village_code,survey_number,surnoc,hissa_number) do update set status='complete',checked_at=excluded.checked_at,matched=excluded.matched,matched_acres=excluded.matched_acres,land_code=excluded.land_code,lease_until=null,lease_token=null;
  return true;
end $$;

-- Older callers have no alias snapshot and cannot overwrite expanded matches.
create or replace function public.record_estate_holder_match(p_user_id uuid,p_holder_name text,p_identity jsonb,p_result jsonb)
returns boolean language sql security definer set search_path=pg_catalog,public as $$
  select public.record_estate_holder_match(p_user_id,p_holder_name,p_identity,p_result,'{}'::text[]);
$$;

create or replace function public.estate_holder_status(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select case when p.user_id is null then null else jsonb_build_object(
    'holderName',p.holder_name,'holderAliases',p.holder_aliases,'configuredAt',p.configured_at,
    'matches',coalesce((select jsonb_agg(jsonb_build_object('identity',jsonb_build_object('villageCode',j.village_code,'surveyNumber',j.survey_number,'surnoc',j.surnoc,'hissaNumber',j.hissa_number),'matchedAcres',j.matched_acres,'landCode',j.land_code,'lastCheckedAt',j.checked_at) order by j.village_code,j.survey_number::integer,j.hissa_number) from public.farm_estate_holder_jobs j where j.user_id=p.user_id and j.matched=true),'[]'::jsonb),
    'surveysTotal',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='options'),
    'surveysChecked',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='options' and status='complete'),
    'recordsChecked',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='record' and status='complete'),
    'pending',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and status in ('pending','working')),
    'unavailable',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and status='unavailable'),
    'lastCheckedAt',(select max(checked_at) from public.farm_estate_holder_jobs where user_id=p.user_id)
  ) end from (select 1) seed left join public.farm_estate_holder_profiles p on p.user_id=p_user_id;
$$;

revoke all on function public.add_estate_holder_alias(uuid,text,text),public.record_estate_holder_match(uuid,text,jsonb,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.add_estate_holder_alias(uuid,text,text),public.record_estate_holder_match(uuid,text,jsonb,jsonb,text[]) to service_role;
comment on column public.farm_estate_holder_profiles.holder_aliases is 'Exact user-approved RTC name variants, private to the same holder profile; not inferred relatives or fuzzy names.';
notify pgrst,'reload schema';
commit;
