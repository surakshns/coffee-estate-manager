-- Fix for databases that ran the original migration.
-- Manual prices have no external_id, so they must not conflict with one another.
alter table public.coffee_prices
  drop constraint if exists coffee_prices_user_id_source_external_id_key;

drop index if exists public.coffee_prices_external_import_key;
create unique index coffee_prices_external_import_key on public.coffee_prices(user_id, source, external_id)
where external_id is not null;
