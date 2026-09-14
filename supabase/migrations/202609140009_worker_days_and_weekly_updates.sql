-- Default attendance for new weeks; historical payments remain unchanged.
alter table public.workers
  add column default_days_worked integer not null default 5
  check (default_days_worked between 0 and 6);

-- Save wages and replace their linked deductions in one transaction. Retrying
-- the same week cannot create duplicate repayments. Manual clearances are kept.
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
  -- Serialize weekly edits for this account, including joint contributions.
  perform id from public.workers where user_id = v_user order by id for update;
  perform id from public.joint_loans where user_id = v_user order by id for update;
  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    where not exists (select 1 from public.workers w where w.id = (row->>'worker_id')::uuid and w.user_id = v_user)
  ) then raise exception 'Worker does not belong to your account.'; end if;

  delete from public.worker_loans
    where user_id = v_user and loan_date = p_week_start and kind = 'repayment'
    and notes = 'Repayment recorded with weekly payment'
    and worker_id in (select (row->>'worker_id')::uuid from jsonb_array_elements(p_rows) row);
  delete from public.joint_loan_repayments
    where user_id = v_user and repayment_date = p_week_start and notes = 'Weekly wage deduction'
    and worker_id in (select (row->>'worker_id')::uuid from jsonb_array_elements(p_rows) row);

  for v_row in select * from jsonb_to_recordset(p_rows) as x(
    worker_id uuid, days_worked numeric, daily_rate numeric, excluded boolean,
    personal_deduction numeric, joint_deduction numeric, joint_loan_id uuid
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
      v_row.personal_deduction := 0; v_row.joint_deduction := 0;
    end if;
    if v_row.personal_deduction is null or v_row.joint_deduction is null
      or v_row.personal_deduction < 0 or v_row.joint_deduction < 0
      or v_row.personal_deduction + v_row.joint_deduction > v_gross then
      raise exception 'Loan deductions must be between zero and the weekly wage.';
    end if;
    if v_row.personal_deduction > 0 then
      select coalesce(sum(case when kind = 'advance' then amount else -amount end), 0)
        into v_balance from public.worker_loans where user_id = v_user and worker_id = v_row.worker_id;
      if v_row.personal_deduction > v_balance then raise exception 'Personal deduction exceeds the loan balance.'; end if;
      insert into public.worker_loans (worker_id, loan_date, amount, kind, notes)
        values (v_row.worker_id, p_week_start, v_row.personal_deduction, 'repayment', 'Repayment recorded with weekly payment');
    end if;
    if v_row.joint_deduction > 0 then
      select loan.amount - coalesce((select sum(amount) from public.joint_loan_repayments where joint_loan_id = loan.id and user_id = v_user), 0)
        into v_balance from public.joint_loans loan
        where loan.id = v_row.joint_loan_id and loan.user_id = v_user
        and v_row.worker_id in (loan.worker_one_id, loan.worker_two_id);
      if v_balance is null or v_row.joint_deduction > v_balance then
        raise exception 'Joint deductions exceed the shared balance, or the worker is not on this loan.';
      end if;
      insert into public.joint_loan_repayments (joint_loan_id, worker_id, repayment_date, amount, notes)
        values (v_row.joint_loan_id, v_row.worker_id, p_week_start, v_row.joint_deduction, 'Weekly wage deduction');
    end if;
    insert into public.weekly_payments (worker_id, week_start, amount, excluded, days_worked, daily_rate, loan_deduction)
      values (v_row.worker_id, p_week_start, v_gross, coalesce(v_row.excluded, false), v_row.days_worked, v_rate, v_row.personal_deduction + v_row.joint_deduction)
      on conflict (worker_id, week_start) do update set amount = excluded.amount, excluded = excluded.excluded,
        days_worked = excluded.days_worked, daily_rate = excluded.daily_rate, loan_deduction = excluded.loan_deduction;
  end loop;
end;
$$;
revoke all on function public.save_weekly_labour(date, jsonb) from public;
grant execute on function public.save_weekly_labour(date, jsonb) to authenticated;
