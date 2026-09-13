-- Monthly field planner: multiple practical tasks and notes per estate month.
create table public.monthly_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_month date not null check (extract(day from plan_month) = 1),
  title text not null check (char_length(trim(title)) between 1 and 140),
  notes text not null default '' check (char_length(notes) <= 2000),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monthly_tasks_user_month_idx on public.monthly_tasks(user_id, plan_month, completed, created_at);
create trigger monthly_tasks_updated before update on public.monthly_tasks for each row execute procedure public.touch_updated_at();

alter table public.monthly_tasks enable row level security;
create policy "Own monthly tasks only" on public.monthly_tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
