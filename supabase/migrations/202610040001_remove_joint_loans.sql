-- Remove the unused shared-loan feature only when both tables are empty.
-- Run after 202609140009_worker_days_and_weekly_updates.sql.
begin;

do $$
begin
  if to_regclass('public.joint_loans') is not null then
    lock table public.joint_loans in access exclusive mode;
    if exists (select 1 from public.joint_loans) then
      raise exception 'Joint loans contain records. Nothing was removed.';
    end if;
  end if;
  if to_regclass('public.joint_loan_repayments') is not null then
    lock table public.joint_loan_repayments in access exclusive mode;
    if exists (select 1 from public.joint_loan_repayments) then
      raise exception 'Joint loan repayments contain records. Nothing was removed.';
    end if;
  end if;
end;
$$;

create or replace function public.save_weekly_labour(p_week_start date, p_rows jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row record;
  v_old public.weekly_payments%rowtype;
  v_gross numeric;
  v_rate numeric;
  v_balance numeric;
begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 3 then
    raise exception 'Choose a Wednesday payment date.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No worker payments supplied.';
  end if;
  if (select count(distinct row->>'worker_id') from jsonb_array_elements(p_rows) row) <> jsonb_array_length(p_rows) then
    raise exception 'Each worker must appear once.';
  end if;
  -- Serialize wage edits and clears for this account.
  perform id from public.workers where user_id = v_user order by id for update;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    where not exists (select 1 from public.workers w where w.id = (row->>'worker_id')::uuid and w.user_id = v_user)
  ) then raise exception 'Worker does not belong to your account.'; end if;

  delete from public.worker_loans
    where user_id = v_user and loan_date = p_week_start and kind = 'repayment'
    and notes = 'Repayment recorded with weekly payment'
    and worker_id in (select (row->>'worker_id')::uuid from jsonb_array_elements(p_rows) row);
  for v_row in select * from jsonb_to_recordset(p_rows) as x(
    worker_id uuid, days_worked numeric, daily_rate numeric, excluded boolean,
    personal_deduction numeric
  ) loop
    select * into v_old from public.weekly_payments
      where user_id = v_user and worker_id = v_row.worker_id and week_start = p_week_start;
    if v_row.days_worked is null or v_row.days_worked < 0 or v_row.days_worked > 7
      or ((v_row.days_worked > 6 or v_row.days_worked <> trunc(v_row.days_worked))
        and v_row.days_worked is distinct from coalesce(v_old.days_worked, round(v_old.amount / nullif(coalesce(v_old.daily_rate, v_row.daily_rate), 0), 1))) then
      raise exception 'Choose working days from 0 to 6.';
    end if;
    v_rate := coalesce(v_old.daily_rate, v_row.daily_rate);
    if v_rate is null or v_rate < 0 or v_rate > 9999999999.99 then
      raise exception 'Enter a valid daily rate.';
    end if;
    v_gross := round(v_row.days_worked * v_rate, 2);
    -- Keep legacy wages exact when their inferred attendance has not changed.
    if v_old.id is not null and v_row.days_worked = coalesce(v_old.days_worked, round(v_old.amount / nullif(v_rate, 0), 1)) then
      v_gross := v_old.amount;
    end if;
    if v_row.excluded then
      v_gross := 0; v_row.days_worked := 0;
      v_row.personal_deduction := 0;
    end if;
    if v_row.personal_deduction is null
      or v_row.personal_deduction < 0
      or v_row.personal_deduction > v_gross then
      raise exception 'Loan deductions must be between zero and the weekly wage.';
    end if;
    if v_row.personal_deduction > 0 then
      select coalesce(sum(case when kind = 'advance' then amount else -amount end), 0)
        into v_balance from public.worker_loans where user_id = v_user and worker_id = v_row.worker_id;
      if v_row.personal_deduction > v_balance then raise exception 'Deduction exceeds the worker’s loan balance.'; end if;
      insert into public.worker_loans (worker_id, loan_date, amount, kind, notes)
        values (v_row.worker_id, p_week_start, v_row.personal_deduction, 'repayment', 'Repayment recorded with weekly payment');
    end if;
    insert into public.weekly_payments (worker_id, week_start, amount, excluded, days_worked, daily_rate, loan_deduction)
      values (v_row.worker_id, p_week_start, v_gross, coalesce(v_row.excluded, false), v_row.days_worked, v_rate, v_row.personal_deduction)
      on conflict (worker_id, week_start) do update set amount = excluded.amount, excluded = excluded.excluded,
        days_worked = excluded.days_worked, daily_rate = excluded.daily_rate, loan_deduction = excluded.loan_deduction;
  end loop;
end;
$$;
revoke all on function public.save_weekly_labour(date, jsonb) from public;
grant execute on function public.save_weekly_labour(date, jsonb) to authenticated;

-- Clearing a week also rolls back its linked repayments atomically.
create or replace function public.clear_weekly_labour(p_week_start date)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please sign in again.'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 3 then
    raise exception 'Choose a Wednesday payment date.';
  end if;
  perform id from public.workers where user_id = v_user order by id for update;
  delete from public.worker_loans where user_id = v_user and loan_date = p_week_start
    and kind = 'repayment' and notes = 'Repayment recorded with weekly payment';
  delete from public.weekly_payments where user_id = v_user and week_start = p_week_start;
end;
$$;
revoke all on function public.clear_weekly_labour(date) from public;
grant execute on function public.clear_weekly_labour(date) to authenticated;

-- No CASCADE: unexpected dependencies should stop the migration.
drop table if exists public.joint_loan_repayments;
drop table if exists public.joint_loans;
drop function if exists public.validate_joint_loan_owner();

commit;
