-- Only non-personal RTC reference fields are kept in the owner's estate.
-- Holder names and related names are intentionally never persisted here.
begin;
alter table public.estates add constraint estates_rtc_reference_details_valid check (
  location_source is null or not (location_source ? 'rtc_reference') or coalesce(
    case when jsonb_typeof(location_source->'rtc_reference') = 'object'
      and jsonb_typeof(location_source->'rtc_reference'->'recorded_extent') = 'object'
    then
      location_source->>'level' = 'hissa'
      and (location_source->'rtc_reference') - array['provider','land_code','ulpin','recorded_extent','source_url','retrieved_at'] = '{}'::jsonb
      and location_source->'rtc_reference'->>'provider' = 'Bhoomi'
      and location_source->'rtc_reference'->>'source_url' = 'https://rdservices.karnataka.gov.in/BhoomiMaps/'
      and jsonb_typeof(location_source->'rtc_reference'->'land_code') = 'string'
      and length(location_source->'rtc_reference'->>'land_code') between 1 and 40
      and (location_source->'rtc_reference'->'ulpin' = 'null'::jsonb or (
        jsonb_typeof(location_source->'rtc_reference'->'ulpin') = 'string'
        and length(location_source->'rtc_reference'->>'ulpin') <= 80))
      and location_source->'rtc_reference'->>'retrieved_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
      and (location_source->'rtc_reference'->'recorded_extent') - array['acres','guntas','fractional_guntas'] = '{}'::jsonb
      and (location_source->'rtc_reference'->'recorded_extent'->'acres' = 'null'::jsonb or (
        jsonb_typeof(location_source->'rtc_reference'->'recorded_extent'->'acres') = 'string'
        and location_source->'rtc_reference'->'recorded_extent'->>'acres' ~ '^\d{1,20}(\.\d{1,18})?$'))
      and (location_source->'rtc_reference'->'recorded_extent'->'guntas' = 'null'::jsonb or (
        jsonb_typeof(location_source->'rtc_reference'->'recorded_extent'->'guntas') = 'string'
        and location_source->'rtc_reference'->'recorded_extent'->>'guntas' ~ '^\d{1,20}(\.\d{1,18})?$'))
      and (location_source->'rtc_reference'->'recorded_extent'->'fractional_guntas' = 'null'::jsonb or (
        jsonb_typeof(location_source->'rtc_reference'->'recorded_extent'->'fractional_guntas') = 'string'
        and location_source->'rtc_reference'->'recorded_extent'->>'fractional_guntas' ~ '^\d{1,20}(\.\d{1,18})?$'))
    else false end, false)
);
commit;
