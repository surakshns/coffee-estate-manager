-- Isolated regression checks. All fixtures and temporary grants roll back.
begin;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, delete on storage.objects to authenticated;
alter table storage.objects enable row level security;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (v_user, v_user || '@integrity-test.invalid'), (v_other, v_other || '@integrity-test.invalid');
  insert into public.workers(id, user_id, name) values (v_worker, v_user, 'Own fixture'), (v_foreign, v_other, 'Foreign fixture');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('estate.test.user', v_user::text, true);
  perform set_config('estate.test.other', v_other::text, true);
  perform set_config('estate.test.worker', v_worker::text, true);
  perform set_config('estate.test.foreign', v_foreign::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  v_user uuid := current_setting('estate.test.user')::uuid;
  v_other uuid := current_setting('estate.test.other')::uuid;
  v_worker uuid := current_setting('estate.test.worker')::uuid;
  v_foreign uuid := current_setting('estate.test.foreign')::uuid;
  v_rejected boolean;
  v_command text;
  v_rows jsonb;
  v_category uuid;
begin
  if exists(select 1 from public.workers where user_id = v_other) then raise exception 'RLS exposes another account.'; end if;
  update public.workers set name = 'Forbidden change' where id = v_foreign;
  if found then raise exception 'RLS permits foreign updates.'; end if;
  v_rejected := false;
  begin
    insert into public.workers(user_id, name) values (v_other, 'Forbidden');
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'RLS permits foreign inserts.'; end if;
  select id into v_category from public.expense_categories where user_id = v_user limit 1;

  for v_command in select unnest(array[
    format('insert into public.expenses(category_id, amount) values (%L, ''NaN'')', v_category),
    format('insert into public.worker_loans(worker_id, amount, kind) values (%L, ''NaN'', ''advance'')', v_worker),
    format('insert into public.weekly_payments(worker_id, week_start, amount, loan_deduction) values (%L, ''2026-10-07'', 100, 101)', v_worker),
    format('insert into public.weekly_payments(worker_id, week_start, amount, days_worked) values (%L, ''2026-10-07'', 100, ''NaN'')', v_worker),
    'insert into public.labour_daily_rates(rate_year, daily_rate) values (2026, ''NaN'')',
    'insert into public.production_records(production_year, bags_produced, bag_weight_kg) values (2026, ''NaN'', 50)',
    'insert into public.sales(production_year, bags_sold, selling_price_per_bag) values (2026, 1, ''NaN'')',
    format('insert into public.property_documents(title, file_path, file_name) values (''Bad path'', %L, ''file.pdf'')', v_other || '/file.pdf'),
    format('insert into public.property_documents(title, file_path, file_name, file_size) values (''Oversized'', %L, ''file.pdf'', 20971521)', v_user || '/file.pdf')
  ]) loop
    v_rejected := false;
    begin execute v_command; exception when check_violation then v_rejected := true; end;
    if not v_rejected then raise exception 'Invalid financial/document record accepted: %', v_command; end if;
  end loop;
  insert into public.property_documents(title, category, notes, file_path, file_name, file_type, file_size, encryption_version, encrypted_metadata)
  values ('Encrypted document', 'Other', '', v_user || '/00000000-0000-0000-0000-000000000001.estateenc', 'encrypted.estateenc', 'application/octet-stream', 42, 1, repeat('A', 44));
  insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'property-documents', v_user || '/00000000-0000-0000-0000-000000000001.estateenc');
  v_rejected := false;
  begin insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'property-documents', v_other || '/file.pdf');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Storage permits foreign uploads.'; end if;

  -- A reviewed CSV import replaces the wage and its linked repayment once.
  insert into public.worker_loans(worker_id, loan_date, amount, kind, notes) values (v_worker, '2026-10-01', 1000, 'advance', 'Manual fixture');
  v_rows := jsonb_build_array(jsonb_build_object('worker_id', v_worker, 'week_start', '2026-10-07', 'amount', 100, 'days_worked', 1, 'daily_rate', 100, 'loan_deduction', 20));
  perform public.import_weekly_payments(v_rows);
  perform public.import_weekly_payments(v_rows);
  if (select count(*) from public.worker_loans where worker_id = v_worker and kind = 'repayment') <> 1 then raise exception 'Import duplicated repayments.'; end if;
  if (select sum(amount) from public.worker_loans where worker_id = v_worker and kind = 'repayment') <> 20 then raise exception 'Import lost deduction.'; end if;
  v_rows := jsonb_build_array(jsonb_build_object('worker_id', v_worker, 'week_start', '2026-10-07', 'amount', 100, 'loan_deduction', 30));
  perform public.import_weekly_payments(v_rows);
  if (select sum(amount) from public.worker_loans where worker_id = v_worker and kind = 'repayment') <> 30 then raise exception 'Import failed to reconcile edited deduction.'; end if;
  if exists(select 1 from public.weekly_pay_runs where user_id = v_user) then raise exception 'CSV bypassed weekly review.'; end if;

  -- Invalid later rows roll back every earlier wage and repayment in the batch.
  v_rejected := false;
  begin
    perform public.import_weekly_payments(v_rows || jsonb_build_array(jsonb_build_object('worker_id', v_worker, 'week_start', '2026-10-14', 'amount', 10, 'loan_deduction', 11)));
  exception when check_violation then v_rejected := true; end;
  if not v_rejected or exists(select 1 from public.weekly_payments where week_start = '2026-10-14') then raise exception 'Import is not atomic.'; end if;
  if (select sum(amount) from public.worker_loans where worker_id = v_worker and kind = 'repayment') <> 30 then raise exception 'Failed import changed previous repayments.'; end if;
  v_rejected := false;
  begin perform public.import_weekly_payments(jsonb_build_array(jsonb_build_object('worker_id', v_foreign, 'week_start', '2026-10-07', 'amount', 100)));
  exception when others then v_rejected := position('Worker does not belong' in sqlerrm) > 0; end;
  if not v_rejected then raise exception 'Import accepts a foreign worker.'; end if;
end;
$$;
reset role;
rollback;
