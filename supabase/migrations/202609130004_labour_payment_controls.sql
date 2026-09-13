-- A weekly payment can be removed for one week without removing the worker.
alter table public.weekly_payments add column if not exists excluded boolean not null default false;

-- A requested worker deletion also removes their payment history.
alter table public.weekly_payments drop constraint if exists weekly_payments_worker_id_fkey;
alter table public.weekly_payments
  add constraint weekly_payments_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;
