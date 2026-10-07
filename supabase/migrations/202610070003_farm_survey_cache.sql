-- Public cadastral outlines only: no ownership, estate profiles or documents.
-- Publisher retrieval runs on the server; opening the picker reads this cache.
begin;

create table public.farm_survey_maps (
  village_code text not null check (village_code in ('2301110012', '2301110038')),
  layer text not null check (layer in ('whole_survey', 'hissa')),
  geojson jsonb not null check (
    coalesce(jsonb_typeof(geojson) = 'object' and geojson->>'type' = 'FeatureCollection'
      and jsonb_typeof(geojson->'features') = 'array', false)
    and octet_length(geojson::text) <= 5000000
  ),
  source_url text not null check (
    (layer = 'whole_survey' and source_url like 'https://kgis.ksrsac.in/kgismaps2/rest/services/CadastralData_Admin/Dynamic_CadastralData_Admin/MapServer/5/query?%')
    or (layer = 'hissa' and source_url like 'https://kgis.ksrsac.in/kgismaps2/rest/services/HissaData/Hissadata_Edgematched/MapServer/1/query?%')
  ),
  retrieved_at timestamptz not null,
  primary key (village_code, layer)
);

alter table public.farm_survey_maps enable row level security;
revoke all on public.farm_survey_maps from public, anon, authenticated;
grant select on public.farm_survey_maps to authenticated;
grant all on public.farm_survey_maps to service_role;
create policy survey_reference_read on public.farm_survey_maps
  for select to authenticated using ((select auth.uid()) is not null);
create policy survey_reference_service on public.farm_survey_maps
  for all to service_role using (true) with check (true);

comment on table public.farm_survey_maps is
  'Validated KGIS public geometry for two supported villages. Service-written reference cache; contains no property documents or owners.';
notify pgrst, 'reload schema';
commit;
