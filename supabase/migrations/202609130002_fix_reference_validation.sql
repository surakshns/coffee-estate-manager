-- Fix for databases that already ran the first migration.
-- This only replaces validation triggers; it does not delete or alter estate records.
drop trigger if exists weekly_payment_worker_owner on public.weekly_payments;
drop trigger if exists expense_category_owner on public.expenses;
drop function if exists public.validate_owned_reference();

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

create trigger weekly_payment_worker_owner before insert or update on public.weekly_payments
for each row execute procedure public.validate_weekly_payment_worker();

create trigger expense_category_owner before insert or update on public.expenses
for each row execute procedure public.validate_expense_category();
