create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  document_date date,
  category text not null default 'Other' check (char_length(trim(category)) > 0),
  notes text not null default '',
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, file_path)
);

create index property_documents_user_created_idx on public.property_documents(user_id, created_at desc);

create trigger property_documents_updated before update on public.property_documents for each row execute procedure public.touch_updated_at();

alter table public.property_documents enable row level security;
create policy "Own property documents only" on public.property_documents for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-documents',
  'property-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can upload own property document files"
on storage.objects for insert to authenticated
with check (bucket_id = 'property-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can read own property document files"
on storage.objects for select to authenticated
using (bucket_id = 'property-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own property document files"
on storage.objects for delete to authenticated
using (bucket_id = 'property-documents' and (storage.foldername(name))[1] = auth.uid()::text);
