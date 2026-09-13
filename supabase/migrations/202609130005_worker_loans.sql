-- Worker advances and repayments. A balance is calculated as advances minus repayments.
create table public.worker_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  loan_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  kind text not null check (kind in ('advance', 'repayment')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index worker_loans_user_date_idx on public.worker_loans(user_id, loan_date desc);
alter table public.worker_loans enable row level security;
create policy "Own worker loans only" on public.worker_loans for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.validate_worker_loan_owner() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.workers where id = new.worker_id and user_id = new.user_id) then
    raise exception 'The selected worker does not belong to this user';
  end if;
  return new;
end; $$;
create trigger worker_loan_worker_owner before insert or update on public.worker_loans for each row execute procedure public.validate_worker_loan_owner();
