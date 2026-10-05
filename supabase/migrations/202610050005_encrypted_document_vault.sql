-- Client-side encryption is additional protection beyond private-bucket RLS.
-- Apply BEFORE deploying the vault UI. Existing plaintext files are preserved
-- for owner-controlled encryption; new/updated documents must be encrypted.
create table public.document_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version smallint not null check (version = 1),
  iterations integer not null check (iterations = 600000),
  salt text not null check (salt ~ '^[A-Za-z0-9+/]{22}==$'),
  verifier text not null check (char_length(verifier) between 44 and 256 and verifier ~ '^[A-Za-z0-9+/]+={0,2}$'),
  created_at timestamptz not null default now()
);
alter table public.document_vaults enable row level security;
alter table public.document_vaults force row level security;
create policy "Read own vault" on public.document_vaults for select to authenticated using (user_id = (select auth.uid()));
create policy "Create own vault" on public.document_vaults for insert to authenticated with check (user_id = (select auth.uid()));
-- Restrictive policies cannot be bypassed by a later broad permissive policy.
create policy "Vault account isolation" on public.document_vaults as restrictive for all to public
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Vault keys cannot be reset" on public.document_vaults as restrictive for update to public using (false) with check (false);
create policy "Vault keys cannot be deleted" on public.document_vaults as restrictive for delete to public using (false);
revoke all on public.document_vaults from anon, authenticated;
grant select, insert on public.document_vaults to authenticated;

alter table public.property_documents add column encryption_version smallint not null default 0;
alter table public.property_documents add column encrypted_metadata text;
alter table public.property_documents add constraint property_documents_encryption_version check (encryption_version in (0, 1));
alter table public.property_documents drop constraint property_documents_size_limit;
alter table public.property_documents add constraint property_documents_size_limit
  check (file_size is null or file_size <= 20971520 + case when encryption_version = 1 then 32 else 0 end) not valid;
-- NOT VALID retains legacy rows, but enforces encryption on every new insert or
-- update. Plain names, titles, dates, categories and notes never accompany it.
alter table public.property_documents add constraint property_documents_encrypted_writes check (
  encryption_version = 1 and encrypted_metadata is not null
  and char_length(encrypted_metadata) between 44 and 32768
  and encrypted_metadata ~ '^[A-Za-z0-9+/]+={0,2}$'
  and title = 'Encrypted document' and category = 'Other' and notes = '' and document_date is null
  and file_name = 'encrypted.estateenc' and file_type = 'application/octet-stream'
  and file_size is not null and file_size between 33 and 20971552
  and file_path ~ ('^' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.estateenc$')
) not valid;
alter table public.property_documents force row level security;
create policy "Property document account isolation" on public.property_documents as restrictive for all to public
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.property_documents from anon;

-- Keep old paths durably queued after encryption/deletion. Failed cleanup can
-- resume on the owner's next vault unlock, without exposing other accounts.
create table public.document_file_cleanup (
  user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, file_path),
  check (file_path ~ ('^' || user_id::text || '/[^/]+$'))
);
alter table public.document_file_cleanup enable row level security;
alter table public.document_file_cleanup force row level security;
create policy "Read own cleanup queue" on public.document_file_cleanup for select to authenticated using (user_id = (select auth.uid()));
create policy "Complete own file cleanup" on public.document_file_cleanup for delete to authenticated using (user_id = (select auth.uid()));
create policy "Cleanup account isolation" on public.document_file_cleanup as restrictive for all to public
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.document_file_cleanup from anon, authenticated;
grant select, delete on public.document_file_cleanup to authenticated;
create function public.queue_property_document_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' or old.file_path is distinct from new.file_path)
    and exists(select 1 from auth.users where id = old.user_id) then
    insert into public.document_file_cleanup(user_id, file_path) values (old.user_id, old.file_path) on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.queue_property_document_cleanup() from public, anon, authenticated;
create trigger property_document_cleanup after update or delete on public.property_documents
  for each row execute function public.queue_property_document_cleanup();

update storage.buckets set public = false, file_size_limit = 20971552,
  allowed_mime_types = array['application/octet-stream'] where id = 'property-documents';
-- Other buckets retain their own policies. For this bucket, even a permissive
-- policy cannot permit anonymous/cross-account access or overwriting files.
create policy "Property storage account isolation" on storage.objects as restrictive for all to public
using (bucket_id <> 'property-documents' or (auth.uid() is not null and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')))
with check (bucket_id <> 'property-documents' or (auth.uid() is not null and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')));
create policy "Property storage encrypted uploads" on storage.objects as restrictive for insert to public
with check (bucket_id <> 'property-documents' or name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.estateenc$'));
create policy "Property storage immutable files" on storage.objects as restrictive for update to public
using (bucket_id <> 'property-documents') with check (bucket_id <> 'property-documents');
