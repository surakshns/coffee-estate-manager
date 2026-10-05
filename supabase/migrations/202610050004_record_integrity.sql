-- Reject invalid new financial data even when a caller bypasses the UI.
-- NOT VALID leaves legacy records untouched; new inserts/updates are checked.
alter table public.workers add constraint workers_finite_amount
  check (default_weekly_amount::text <> 'NaN') not valid;
alter table public.weekly_payments add constraint weekly_payments_finite_numbers
  check (amount::text <> 'NaN' and loan_deduction::text <> 'NaN'
    and days_worked::text <> 'NaN' and daily_rate::text <> 'NaN') not valid;
alter table public.weekly_payments add constraint weekly_payments_deduction_within_wages
  check (excluded or loan_deduction <= amount) not valid;
alter table public.worker_loans add constraint worker_loans_finite_amount
  check (amount::text <> 'NaN') not valid;
alter table public.labour_daily_rates add constraint labour_daily_rates_finite_amount
  check (daily_rate::text <> 'NaN') not valid;
alter table public.expenses add constraint expenses_finite_amount
  check (amount::text <> 'NaN') not valid;
alter table public.coffee_prices add constraint coffee_prices_finite_amount
  check (price_per_kg::text <> 'NaN') not valid;
alter table public.production_records add constraint production_records_finite_numbers
  check (bags_produced::text <> 'NaN' and bag_weight_kg::text <> 'NaN') not valid;
alter table public.sales add constraint sales_finite_numbers
  check (bags_sold::text <> 'NaN' and selling_price_per_bag::text <> 'NaN') not valid;

-- Metadata must point to a file inside the account's private storage folder.
alter table public.property_documents add constraint property_documents_owned_path
  check (file_path ~ ('^' || user_id::text || '/[^/]+$')) not valid;
alter table public.property_documents add constraint property_documents_size_limit
  check (file_size is null or file_size <= 20971520) not valid;

create index workers_user_name_id_idx on public.workers(user_id, name, id);
create index production_records_user_year_idx on public.production_records(user_id, production_year desc, id);

-- Restore wages and their linked loan repayments as one transaction.
-- Imports remain reviewable: existing completion-invalidation triggers still run.
create or replace function public.import_weekly_payments(p_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row record;
  v_amount numeric;
  v_deduction numeric;
begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Supply an array of weekly payments.'; end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 10000 then raise exception 'Import between 1 and 10,000 payments.'; end if;
  if (select count(distinct (row->>'worker_id', row->>'week_start')) from jsonb_array_elements(p_rows) row) <> jsonb_array_length(p_rows) then
    raise exception 'Each worker and payment date must appear once.';
  end if;
  perform id from public.workers where user_id = v_user order by id for update;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    where not exists (select 1 from public.workers w where w.id = (row->>'worker_id')::uuid and w.user_id = v_user)
  ) then raise exception 'Worker does not belong to your account.'; end if;
  for v_row in select * from jsonb_to_recordset(p_rows) as x(
    worker_id uuid, week_start date, amount numeric, days_worked numeric,
    daily_rate numeric, loan_deduction numeric, excluded boolean
  ) loop
    if v_row.week_start is null or extract(isodow from v_row.week_start) <> 3 then raise exception 'Choose a Wednesday payment date.'; end if;
    v_amount := case when coalesce(v_row.excluded, false) then 0 else v_row.amount end;
    v_deduction := case when coalesce(v_row.excluded, false) then 0 else coalesce(v_row.loan_deduction, 0) end;
    -- Table constraints reject NaN, negatives and deductions above gross wages.
    insert into public.weekly_payments(worker_id, week_start, amount, days_worked, daily_rate, loan_deduction, excluded)
      values (v_row.worker_id, v_row.week_start, v_amount, case when coalesce(v_row.excluded, false) then 0 else v_row.days_worked end, v_row.daily_rate, v_deduction, coalesce(v_row.excluded, false))
      on conflict (worker_id, week_start) do update set
        amount = excluded.amount, days_worked = excluded.days_worked,
        daily_rate = excluded.daily_rate, loan_deduction = excluded.loan_deduction, excluded = excluded.excluded;
    delete from public.worker_loans where user_id = v_user and worker_id = v_row.worker_id
      and loan_date = v_row.week_start and kind = 'repayment' and notes = 'Repayment recorded with weekly payment';
    if v_deduction > 0 then
      insert into public.worker_loans(worker_id, loan_date, amount, kind, notes)
        values (v_row.worker_id, v_row.week_start, v_deduction, 'repayment', 'Repayment recorded with weekly payment');
    end if;
  end loop;
end;
$$;
revoke all on function public.import_weekly_payments(jsonb) from public, anon;
grant execute on function public.import_weekly_payments(jsonb) to authenticated;
