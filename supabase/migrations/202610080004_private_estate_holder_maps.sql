-- Private holder matching. Public map geometry never contains names or holdings.
begin;
create table public.farm_estate_holder_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  holder_name text not null check (length(holder_name) between 1 and 100 and holder_name !~ '[[:cntrl:]<>]'),
  configured_at timestamptz not null default now()
);
create table public.farm_estate_holder_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.farm_estate_holder_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('options','record')),
  village_code text not null check (village_code in ('2301110012','2301110038')),
  survey_number text not null check (survey_number ~ '^[1-9][0-9]{0,5}$'),
  surnoc text not null default '' check (surnoc ~ '^[A-Za-z0-9*./_-]{0,20}$'),
  hissa_number text not null default '' check (hissa_number ~ '^[A-Za-z0-9*./_-]{0,20}$'),
  status text not null default 'pending' check (status in ('pending','working','complete','unavailable')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_run_at timestamptz not null default now(),
  last_started_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  checked_at timestamptz,
  matched boolean,
  matched_acres numeric(18,8) check (matched_acres between 0 and 10000000),
  land_code text check (length(land_code) between 1 and 40),
  check ((kind='options' and surnoc='' and hissa_number='') or (kind='record' and surnoc<>'' and hissa_number<>'')),
  check (matched is null or (kind='record' and status='complete' and checked_at is not null)),
  check (matched is not true or land_code is not null),
  unique (user_id,kind,village_code,survey_number,surnoc,hissa_number)
);
create index estate_holder_pending on public.farm_estate_holder_jobs(next_run_at,id) where status in ('pending','working');
create index estate_holder_matches on public.farm_estate_holder_jobs(user_id) where matched=true;

-- Claim history survives account/holder changes and deleted queue rows.
create table public.farm_estate_holder_worker_limit (
  singleton boolean primary key default true check (singleton),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 0 and 4)
);
alter table public.farm_estate_holder_worker_limit enable row level security;
revoke all on public.farm_estate_holder_worker_limit from public,anon,authenticated;
grant all on public.farm_estate_holder_worker_limit to service_role;

alter table public.farm_estate_holder_profiles enable row level security;
alter table public.farm_estate_holder_jobs enable row level security;
revoke all on public.farm_estate_holder_profiles, public.farm_estate_holder_jobs from public, anon, authenticated;
grant select on public.farm_estate_holder_profiles, public.farm_estate_holder_jobs to authenticated;
grant all on public.farm_estate_holder_profiles, public.farm_estate_holder_jobs to service_role;
grant usage, select on sequence public.farm_estate_holder_jobs_id_seq to service_role;
do $$ declare t text; begin
  foreach t in array array['farm_estate_holder_profiles','farm_estate_holder_jobs'] loop
    execute format('create policy holder_private_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
    execute format('create policy holder_account_guard on public.%I as restrictive for all to public using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()))',t);
    execute format('create policy holder_no_client_insert on public.%I as restrictive for insert to authenticated,anon with check (false)',t);
    execute format('create policy holder_no_client_update on public.%I as restrictive for update to authenticated,anon using (false) with check (false)',t);
    execute format('create policy holder_no_client_delete on public.%I as restrictive for delete to authenticated,anon using (false)',t);
  end loop;
end $$;

-- Called only after the server has verified the selected name in an exact RTC.
create function public.configure_estate_holder(p_user_id uuid,p_holder_name text,p_anchor jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous_name text; v text; s text; sn text; h text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,817360822));
  if p_anchor is null or jsonb_typeof(p_anchor)<>'object' or p_anchor-array['villageCode','surveyNumber','surnoc','hissaNumber']<>'{}'::jsonb then raise exception 'Invalid holder anchor'; end if;
  v:=p_anchor->>'villageCode'; s:=p_anchor->>'surveyNumber'; sn:=p_anchor->>'surnoc'; h:=p_anchor->>'hissaNumber';
  if v not in ('2301110012','2301110038') or s!~'^[1-9][0-9]{0,5}$' or sn!~'^[A-Za-z0-9*./_-]{1,20}$' or h!~'^[A-Za-z0-9*./_-]{1,20}$' or v is null or s is null or sn is null or h is null then raise exception 'Invalid holder anchor'; end if;
  select holder_name into previous_name from public.farm_estate_holder_profiles where user_id=p_user_id for update;
  insert into public.farm_estate_holder_profiles(user_id,holder_name) values(p_user_id,p_holder_name)
    on conflict(user_id) do update set holder_name=excluded.holder_name,configured_at=case when farm_estate_holder_profiles.holder_name<>excluded.holder_name then now() else farm_estate_holder_profiles.configured_at end;
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

-- One global transient lookup at a time, at most four actions per minute.
-- Expired leases are retryable; a stale worker cannot commit against a new lease.
create function public.claim_estate_holder_job() returns jsonb
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
  return jsonb_build_object('id',j.id,'token',token,'userId',j.user_id,'holderName',(select holder_name from public.farm_estate_holder_profiles where user_id=j.user_id),'kind',j.kind,'identity',jsonb_build_object('villageCode',j.village_code,'surveyNumber',j.survey_number,'surnoc',j.surnoc,'hissaNumber',j.hissa_number));
end $$;

-- A normal selected RTC lookup can refresh its private match immediately.
-- Bind to the profile name used by that lookup so a concurrent name change
-- cannot add the old holder's record to the new holder's map.
create function public.record_estate_holder_match(p_user_id uuid,p_holder_name text,p_identity jsonb,p_result jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,817360822));
  if not exists(select 1 from public.farm_estate_holder_profiles where user_id=p_user_id and holder_name=p_holder_name) then return false; end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_identity-array['villageCode','surveyNumber','surnoc','hissaNumber']<>'{}'::jsonb
    or p_result is null or jsonb_typeof(p_result)<>'object' or p_result-array['matches','acres','landCode']<>'{}'::jsonb or not coalesce(jsonb_typeof(p_result->'matches')='boolean',false) then raise exception 'Invalid match reference'; end if;
  insert into public.farm_estate_holder_jobs(user_id,kind,village_code,survey_number,surnoc,hissa_number,status,checked_at,matched,matched_acres,land_code)
    values(p_user_id,'record',p_identity->>'villageCode',p_identity->>'surveyNumber',p_identity->>'surnoc',p_identity->>'hissaNumber','complete',clock_timestamp(),(p_result->>'matches')::boolean,case when (p_result->>'matches')::boolean then (p_result->>'acres')::numeric else null end,p_result->>'landCode')
    on conflict(user_id,kind,village_code,survey_number,surnoc,hissa_number) do update set status='complete',checked_at=excluded.checked_at,matched=excluded.matched,matched_acres=excluded.matched_acres,land_code=excluded.land_code,lease_until=null,lease_token=null;
  return true;
end $$;

create function public.finish_estate_holder_job(p_id bigint,p_token uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.farm_estate_holder_jobs; e jsonb;
begin
  select * into j from public.farm_estate_holder_jobs where id=p_id and lease_token=p_token and status='working' for update;
  if j.id is null then return false; end if;
  if p_result is null then
    update public.farm_estate_holder_jobs set status=case when attempts>=3 then 'unavailable' else 'pending' end,next_run_at=clock_timestamp()+interval '15 minutes'*attempts,lease_until=null,lease_token=null where id=j.id;
    return true;
  end if;
  if j.kind='options' then
    if jsonb_typeof(p_result)<>'array' or jsonb_array_length(p_result)>1000 then raise exception 'Invalid RTC options'; end if;
    for e in select value from jsonb_array_elements(p_result) loop
      if jsonb_typeof(e)<>'object' or e-array['surnoc','hissaNumber']<>'{}'::jsonb or coalesce(e->>'surnoc','')!~'^[A-Za-z0-9*./_-]{1,20}$' or coalesce(e->>'hissaNumber','')!~'^[A-Za-z0-9*./_-]{1,20}$' then raise exception 'Invalid RTC option'; end if;
      insert into public.farm_estate_holder_jobs(user_id,kind,village_code,survey_number,surnoc,hissa_number)
        values(j.user_id,'record',j.village_code,j.survey_number,e->>'surnoc',e->>'hissaNumber') on conflict do nothing;
    end loop;
    update public.farm_estate_holder_jobs set status='complete',checked_at=clock_timestamp(),lease_until=null,lease_token=null where id=j.id;
  else
    if jsonb_typeof(p_result)<>'object' or p_result-array['matches','acres','landCode']<>'{}'::jsonb or not coalesce(jsonb_typeof(p_result->'matches')='boolean',false) then raise exception 'Invalid match result'; end if;
    update public.farm_estate_holder_jobs set status='complete',checked_at=clock_timestamp(),matched=(p_result->>'matches')::boolean,matched_acres=case when (p_result->>'matches')::boolean then (p_result->>'acres')::numeric else null end,land_code=p_result->>'landCode',lease_until=null,lease_token=null where id=j.id;
  end if;
  return true;
end $$;

create function public.estate_holder_status(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select case when p.user_id is null then null else jsonb_build_object(
    'holderName',p.holder_name,'configuredAt',p.configured_at,
    'matches',coalesce((select jsonb_agg(jsonb_build_object('identity',jsonb_build_object('villageCode',j.village_code,'surveyNumber',j.survey_number,'surnoc',j.surnoc,'hissaNumber',j.hissa_number),'matchedAcres',j.matched_acres,'landCode',j.land_code,'lastCheckedAt',j.checked_at) order by j.village_code,j.survey_number::integer,j.hissa_number) from public.farm_estate_holder_jobs j where j.user_id=p.user_id and j.matched=true),'[]'::jsonb),
    'surveysTotal',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='options'),
    'surveysChecked',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='options' and status='complete'),
    'recordsChecked',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and kind='record' and status='complete'),
    'pending',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and status in ('pending','working')),
    'unavailable',(select count(*) from public.farm_estate_holder_jobs where user_id=p.user_id and status='unavailable'),
    'lastCheckedAt',(select max(checked_at) from public.farm_estate_holder_jobs where user_id=p.user_id)
  ) end from (select 1) seed left join public.farm_estate_holder_profiles p on p.user_id=p_user_id;
$$;
revoke all on function public.configure_estate_holder(uuid,text,jsonb),public.claim_estate_holder_job(),public.finish_estate_holder_job(bigint,uuid,jsonb),public.estate_holder_status(uuid),public.record_estate_holder_match(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.configure_estate_holder(uuid,text,jsonb),public.claim_estate_holder_job(),public.finish_estate_holder_job(bigint,uuid,jsonb),public.estate_holder_status(uuid),public.record_estate_holder_match(uuid,text,jsonb,jsonb) to service_role;
comment on table public.farm_estate_holder_jobs is 'Account-private RTC matching progress and verified non-personal matching references; other holder names/rows and documents are never retained.';
notify pgrst,'reload schema';
commit;
