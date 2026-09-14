-- Year-specific daily pay settings. Existing weekly payments keep their saved rate.
create table public.labour_daily_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rate_year integer not null check (rate_year between 2000 and 2200),
  daily_rate numeric(12,2) not null check (daily_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rate_year)
);

alter table public.weekly_payments
  add column days_worked numeric(4,1) check (days_worked >= 0 and days_worked <= 7),
  add column daily_rate numeric(12,2) check (daily_rate >= 0),
  add column loan_deduction numeric(12,2) not null default 0 check (loan_deduction >= 0);

-- A joint loan stores its total only once. Repayments record either a wage
-- deduction for one member or a standalone clearance (with no worker id).
create table public.joint_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  worker_one_id uuid not null references public.workers(id) on delete cascade,
  worker_two_id uuid not null references public.workers(id) on delete cascade,
  loan_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (worker_one_id <> worker_two_id)
);

create table public.joint_loan_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  joint_loan_id uuid not null references public.joint_loans(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete set null,
  repayment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index labour_daily_rates_user_year_idx on public.labour_daily_rates (user_id, rate_year);
create index joint_loans_user_date_idx on public.joint_loans (user_id, loan_date desc);
create index joint_loan_repayments_loan_date_idx on public.joint_loan_repayments (joint_loan_id, repayment_date desc);

create trigger set_labour_daily_rates_updated_at
before update on public.labour_daily_rates
for each row execute function public.touch_updated_at();

alter table public.labour_daily_rates enable row level security;
alter table public.joint_loans enable row level security;
alter table public.joint_loan_repayments enable row level security;

create policy "Users manage their own daily rates"
  on public.labour_daily_rates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own joint loans"
  on public.joint_loans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage their own joint loan repayments"
  on public.joint_loan_repayments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.validate_joint_loan_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.joint_loans loan
    where loan.id = new.joint_loan_id and loan.user_id = new.user_id
  ) then
    raise exception 'Joint loan must belong to the same user';
  end if;
  if new.worker_id is not null and not exists (
    select 1 from public.workers worker
    join public.joint_loans loan on loan.id = new.joint_loan_id
    where worker.id = new.worker_id
      and worker.user_id = new.user_id
      and new.worker_id in (loan.worker_one_id, loan.worker_two_id)
  ) then
    raise exception 'Weekly joint repayment must be recorded against a joint-loan worker';
  end if;
  return new;
end;
$$;

create trigger check_joint_loan_repayment_owner
before insert or update on public.joint_loan_repayments
for each row execute function public.validate_joint_loan_owner();
