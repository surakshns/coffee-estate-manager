-- Coffee Estate Manager schema. Apply with: supabase db push
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  active boolean not null default true,
  default_weekly_amount numeric(12,2) not null default 0 check (default_weekly_amount >= 0),
  created_at timestamptz not null default now()
);

create table public.weekly_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete restrict,
  week_start date not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, week_start)
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expense_date date not null default current_date,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  description text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- external_id and imported_at make later API imports idempotent without changing the UI model.
create table public.coffee_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  price_date date not null,
  coffee_type text not null,
  grade text not null default 'Standard',
  source text not null default 'Manual entry',
  price_per_kg numeric(12,2) not null check (price_per_kg >= 0),
  external_id text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
);
create unique index coffee_prices_external_import_key on public.coffee_prices(user_id, source, external_id)
where external_id is not null;

create table public.production_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  production_year int not null check (production_year between 2000 and 2200),
  bags_produced numeric(12,2) not null check (bags_produced >= 0),
  bag_weight_kg numeric(12,2) not null check (bag_weight_kg > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sale_date date not null default current_date,
  production_year int not null check (production_year between 2000 and 2200),
  bags_sold numeric(12,2) not null check (bags_sold >= 0),
  selling_price_per_bag numeric(12,2) not null check (selling_price_per_bag >= 0),
  buyer text not null default '',
  created_at timestamptz not null default now()
);

create index expenses_user_date_idx on public.expenses(user_id, expense_date desc);
create index weekly_payments_user_week_idx on public.weekly_payments(user_id, week_start desc);
create index coffee_prices_user_date_idx on public.coffee_prices(user_id, price_date desc);
create index sales_user_year_idx on public.sales(user_id, production_year);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger weekly_payments_updated before update on public.weekly_payments for each row execute procedure public.touch_updated_at();
create trigger expenses_updated before update on public.expenses for each row execute procedure public.touch_updated_at();

create or replace function public.validate_weekly_payment_worker() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.workers where id = new.worker_id and user_id = new.user_id) then
    raise exception 'The selected worker does not belong to this user';
  end if;
  return new;
end; $$;
create or replace function public.validate_expense_category() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.expense_categories where id = new.category_id and user_id = new.user_id) then
    raise exception 'The selected category does not belong to this user';
  end if;
  return new;
end; $$;
create trigger weekly_payment_worker_owner before insert or update on public.weekly_payments for each row execute procedure public.validate_weekly_payment_worker();
create trigger expense_category_owner before insert or update on public.expenses for each row execute procedure public.validate_expense_category();

create or replace function public.create_profile_and_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  insert into public.expense_categories (user_id, name) values
    (new.id, 'Irrigation'), (new.id, 'Manure'), (new.id, 'Shade Lopping'), (new.id, 'Miscellaneous');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.create_profile_and_categories();

-- RLS: no record is visible or mutable outside its owning account.
alter table public.profiles enable row level security;
alter table public.workers enable row level security;
alter table public.weekly_payments enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.coffee_prices enable row level security;
alter table public.production_records enable row level security;
alter table public.sales enable row level security;

create policy "Own profile only" on public.profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Own workers only" on public.workers for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own payments only" on public.weekly_payments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own categories only" on public.expense_categories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own expenses only" on public.expenses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own prices only" on public.coffee_prices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own production only" on public.production_records for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Own sales only" on public.sales for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.seed_demo_coffee_estate_for(target_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare irrigation uuid; manure uuid; misc uuid;
begin
  if exists (select 1 from public.workers where user_id = target_user) then
    raise exception 'Demo data has already been loaded for this user';
  end if;
  insert into public.expense_categories (user_id, name) values
    (target_user, 'Irrigation'), (target_user, 'Manure'), (target_user, 'Shade Lopping'), (target_user, 'Miscellaneous')
  on conflict (user_id, name) do nothing;
  select id into irrigation from public.expense_categories where user_id = target_user and name = 'Irrigation';
  select id into manure from public.expense_categories where user_id = target_user and name = 'Manure';
  select id into misc from public.expense_categories where user_id = target_user and name = 'Miscellaneous';
  insert into public.workers (user_id, name, active, default_weekly_amount) values
    (target_user, 'Asha', true, 1600), (target_user, 'Bala', true, 1450), (target_user, 'Chetan', true, 1300);
  insert into public.expenses (user_id, expense_date, category_id, description, amount) values
    (target_user, current_date - 40, irrigation, 'Pump maintenance', 4800),
    (target_user, current_date - 25, manure, 'Organic manure', 9800),
    (target_user, current_date - 12, misc, 'Transport supplies', 2250);
  insert into public.coffee_prices (user_id, price_date, coffee_type, grade, source, price_per_kg) values
    (target_user, current_date - 365 * 4, 'Arabica', 'Plantation A', 'Demo market', 285),
    (target_user, current_date - 365 * 3, 'Arabica', 'Plantation A', 'Demo market', 310),
    (target_user, current_date - 365 * 2, 'Arabica', 'Plantation A', 'Demo market', 340),
    (target_user, current_date - 365, 'Arabica', 'Plantation A', 'Demo market', 365),
    (target_user, current_date, 'Arabica', 'Plantation A', 'Demo market', 390);
  insert into public.production_records (user_id, production_year, bags_produced, bag_weight_kg, notes) values
    (target_user, extract(year from current_date)::int, 120, 50, 'Main harvest');
  insert into public.sales (user_id, sale_date, production_year, bags_sold, selling_price_per_bag, buyer) values
    (target_user, current_date - 10, extract(year from current_date)::int, 80, 19500, 'Local cooperative');
end; $$;

create or replace function public.seed_my_demo_coffee_estate() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in before loading demo data'; end if;
  perform public.seed_demo_coffee_estate_for(auth.uid());
end; $$;
revoke all on function public.seed_demo_coffee_estate_for(uuid) from public, anon, authenticated;
grant execute on function public.seed_my_demo_coffee_estate() to authenticated;
