-- Run against a test database with every migration. Nothing survives rollback.
begin;
grant usage on schema public, auth, storage to authenticated, anon;
grant select, insert, update, delete on public.property_documents, public.document_vaults, public.document_file_cleanup, storage.objects to authenticated, anon;
alter table storage.objects enable row level security;
-- Simulate an accidental broad permissive policy: restrictive guards must win.
create policy "Vault regression broad grant" on public.document_vaults for all to public using (true) with check (true);
create policy "Documents regression broad grant" on public.property_documents for all to public using (true) with check (true);
create policy "Storage regression broad grant" on storage.objects for all to public using (true) with check (true);
create policy "Cleanup regression broad grant" on public.document_file_cleanup for all to public using (true) with check (true);
do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values (v_user, v_user || '@vault-test.invalid'), (v_other, v_other || '@vault-test.invalid');
  perform set_config('estate.vault.user', v_user::text, true);
  perform set_config('estate.vault.other', v_other::text, true);
  perform set_config('estate.vault.id', v_id::text, true);
  insert into public.document_vaults(user_id, version, iterations, salt, verifier)
  values (v_user, 1, 600000, repeat('A', 22) || '==', repeat('A', 80)), (v_other, 1, 600000, repeat('B', 22) || '==', repeat('B', 80));
  insert into public.property_documents(id, user_id, title, category, notes, file_path, file_name, file_type, file_size, encryption_version, encrypted_metadata)
  values (v_id, v_user, 'Encrypted document', 'Other', '', v_user || '/00000000-0000-0000-0000-000000000001.estateenc', 'encrypted.estateenc', 'application/octet-stream', 100, 1, repeat('A', 80)),
  (gen_random_uuid(), v_other, 'Encrypted document', 'Other', '', v_other || '/00000000-0000-0000-0000-000000000001.estateenc', 'encrypted.estateenc', 'application/octet-stream', 100, 1, repeat('B', 80));
  insert into storage.objects(id, bucket_id, name) values
  (gen_random_uuid(), 'property-documents', v_user || '/00000000-0000-0000-0000-000000000001.estateenc'),
  (gen_random_uuid(), 'property-documents', v_other || '/00000000-0000-0000-0000-000000000001.estateenc');
  insert into public.document_file_cleanup(user_id, file_path) values (v_other, v_other || '/old.pdf');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
end;
$$;
set local role authenticated;
do $$
declare
  v_user uuid := current_setting('estate.vault.user')::uuid;
  v_other uuid := current_setting('estate.vault.other')::uuid;
  v_id uuid := current_setting('estate.vault.id')::uuid;
  v_rejected boolean;
begin
  if (select count(*) from public.document_vaults) <> 1 then raise exception 'Foreign vault is visible.'; end if;
  if (select count(*) from public.property_documents) <> 1 then raise exception 'Foreign document details are visible.'; end if;
  if (select count(*) from storage.objects where bucket_id = 'property-documents') <> 1 then raise exception 'Foreign file is visible.'; end if;
  if exists(select 1 from public.document_file_cleanup) then raise exception 'Foreign cleanup paths are visible.'; end if;
  update public.document_vaults set salt = repeat('C', 22) || '==';
  if found then raise exception 'Vault salt can be reset.'; end if;
  delete from public.document_vaults;
  if found then raise exception 'Vault can be deleted.'; end if;
  delete from public.property_documents where user_id = v_other;
  if found then raise exception 'Foreign documents can be deleted.'; end if;
  delete from storage.objects where bucket_id = 'property-documents' and name like v_other || '/%';
  if found then raise exception 'Foreign files can be deleted.'; end if;
  v_rejected := false;
  begin insert into public.document_vaults(user_id, version, iterations, salt, verifier) values (v_other, 1, 600000, repeat('A', 22) || '==', repeat('A', 80));
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Foreign vault creation is allowed.'; end if;
  v_rejected := false;
  begin insert into public.property_documents(user_id, title, category, notes, file_path, file_name, file_type, file_size, encryption_version, encrypted_metadata)
  values (v_other, 'Encrypted document', 'Other', '', v_other || '/00000000-0000-0000-0000-000000000003.estateenc', 'encrypted.estateenc', 'application/octet-stream', 100, 1, repeat('A', 80));
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Foreign document creation is allowed.'; end if;
  update storage.objects set name = v_user || '/00000000-0000-0000-0000-000000000002.estateenc' where bucket_id = 'property-documents';
  if found then raise exception 'Property files can be overwritten.'; end if;
  v_rejected := false;
  begin insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'property-documents', v_other || '/00000000-0000-0000-0000-000000000002.estateenc');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Foreign encrypted uploads are allowed.'; end if;
  v_rejected := false;
  begin insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'property-documents', v_user || '/unencrypted.pdf');
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Legacy plaintext upload paths are allowed.'; end if;
  v_rejected := false;
  begin insert into public.property_documents(title, file_path, file_name) values ('Secret name', v_user || '/plaintext.pdf', 'plaintext.pdf');
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'New plaintext document records are allowed.'; end if;
  update public.property_documents set file_path = v_user || '/00000000-0000-0000-0000-000000000002.estateenc' where id = v_id;
  if not exists(select 1 from public.document_file_cleanup where file_path = v_user || '/00000000-0000-0000-0000-000000000001.estateenc') then raise exception 'Replacement did not queue its old file.'; end if;
  delete from public.property_documents where id = v_id;
  if not exists(select 1 from public.document_file_cleanup where file_path = v_user || '/00000000-0000-0000-0000-000000000002.estateenc') then raise exception 'Deletion did not queue its file.'; end if;
  delete from public.document_file_cleanup where user_id = v_other;
  if found then raise exception 'Foreign cleanup entries can be removed.'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  if exists(select 1 from public.property_documents) or exists(select 1 from public.document_vaults) or exists(select 1 from public.document_file_cleanup) or exists(select 1 from storage.objects where bucket_id = 'property-documents') then raise exception 'Anonymous access exposes documents.'; end if;
end;
$$;
reset role;
do $$
begin
  if (select public from storage.buckets where id = 'property-documents') then raise exception 'Bucket is public.'; end if;
  if (select allowed_mime_types from storage.buckets where id = 'property-documents') <> array['application/octet-stream'] then raise exception 'Bucket accepts plaintext MIME types.'; end if;
  -- Account deletion must not fail because a cleanup trigger tries to enqueue
  -- a path with a now-deleted Auth foreign key.
  delete from auth.users where id = current_setting('estate.vault.other')::uuid;
end;
$$;
rollback;
