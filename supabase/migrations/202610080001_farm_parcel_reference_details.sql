-- Optional derived map measurements stay in the existing private provenance.
-- They never update recorded ownership, total estate area or cultivated area.
begin;
alter table public.estates add constraint estates_parcel_reference_details_valid check (
  location_source is null or not (location_source ? 'parcel_details') or coalesce(
    case when jsonb_typeof(location_source->'parcel_details') = 'object'
      and jsonb_typeof(location_source->'parcel_details'->'bounds') = 'array'
    then
      location_source->'parcel_details'->>'area_method' = 'local_projection'
      and location_source->'parcel_details'->>'record_match' in ('matching_hissa','not_checked')
      and location_source->'parcel_details'->'lgd_village_code' =
        case location_source->>'village_code' when '2301110012' then '614874'::jsonb when '2301110038' then '614895'::jsonb end
      and jsonb_typeof(location_source->'parcel_details'->'mapped_area_m2') = 'number'
      and location_source->'parcel_details'->'mapped_area_m2' > '0'::jsonb
      and location_source->'parcel_details'->'mapped_area_m2' <= '1000000000'::jsonb
      and jsonb_typeof(location_source->'parcel_details'->'geometry_parts') = 'number'
      and location_source->'parcel_details'->>'geometry_parts' ~ '^[1-9][0-9]{0,3}$'
      and location_source->'parcel_details'->'geometry_parts' >= '1'::jsonb
      and location_source->'parcel_details'->'geometry_parts' <= '1000'::jsonb
      and jsonb_array_length(location_source->'parcel_details'->'bounds') = 4
      and jsonb_typeof(location_source->'parcel_details'->'bounds'->0) = 'number'
      and jsonb_typeof(location_source->'parcel_details'->'bounds'->1) = 'number'
      and jsonb_typeof(location_source->'parcel_details'->'bounds'->2) = 'number'
      and jsonb_typeof(location_source->'parcel_details'->'bounds'->3) = 'number'
      and location_source->'parcel_details'->'bounds'->0 >= '74'::jsonb
      and location_source->'parcel_details'->'bounds'->2 <= '78'::jsonb
      and location_source->'parcel_details'->'bounds'->1 >= '11'::jsonb
      and location_source->'parcel_details'->'bounds'->3 <= '16'::jsonb
      and location_source->'parcel_details'->'bounds'->0 < location_source->'parcel_details'->'bounds'->2
      and location_source->'parcel_details'->'bounds'->1 < location_source->'parcel_details'->'bounds'->3
    else false end, false
  )
);
commit;
