-- Convert the annual planner into an evergreen January–December estate guide.
-- Existing entries are retained and mapped to their calendar month.
drop index if exists public.monthly_tasks_user_month_idx;

alter table public.monthly_tasks
  add column if not exists month_number smallint check (month_number between 1 and 12);

update public.monthly_tasks
  set month_number = extract(month from plan_month)::smallint
  where month_number is null;

alter table public.monthly_tasks
  alter column month_number set not null;

alter table public.monthly_tasks
  drop column if exists plan_month,
  drop column if exists completed;

create index monthly_tasks_user_month_idx
  on public.monthly_tasks(user_id, month_number, created_at);
