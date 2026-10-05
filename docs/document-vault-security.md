# Property document vault

This update adds client-side encryption on top of Supabase authentication, account isolation and a private storage bucket. It is implemented locally; production settings and existing production files have not been inspected or changed.

## Activate the protection

1. Apply all pending migrations in filename order, including [202610050005_encrypted_document_vault.sql](../supabase/migrations/202610050005_encrypted_document_vault.sql), **before publishing the updated frontend**. The previous integrity migration is also required. The vault update does not require a new Edge Function.
2. Build and publish the updated app over HTTPS. Confirm the `property-documents` bucket is private. Use a publishable/anon client key; keep service-role/secret keys exclusively in trusted server configuration.
3. Open **Documents**, create a unique vault password of at least 16 characters, confirm it, and save it in a password manager. The password is separate from the login password. Several randomly chosen words are suitable.
4. Unlock the vault and choose **Encrypt existing documents**. Every old file is downloaded privately, encrypted, uploaded under a random name, downloaded again, decrypted and compared using SHA-256 before the record is replaced. Original files are then removed.
5. Complete any **Retry queued file cleanup** action. The database queues original paths atomically with replacement/deletion, so a interrupted/failed cleanup is retried on the next unlock. Do not treat conversion as complete while old-file cleanup is pending.
6. Check from a signed-out browser and a different account that document access is denied. SQL regression tests cover these rules in an isolated PostgreSQL environment; a production verification must use the deployed project.

Deploying the migration prevents the old frontend from creating plaintext document records. Publish the updated frontend promptly after applying it. Existing rows/files remain available for conversion; the migration itself cannot encrypt them because it does not know the user's vault password.

## Protection implemented

- **Files and identifying details:** AES-GCM with a 256-bit key, a random 96-bit nonce per encryption and a 128-bit authentication tag. Titles, filenames, categories, dates and notes are encrypted. Stored rows use generic placeholders and objects have random `.estateenc` paths. Account ID, object size, creation time and file count remain visible to infrastructure operators.
- **Password derivation:** native Web Crypto PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random 128-bit per-vault salt. Only the salt, derivation parameters and an encrypted verifier are stored. The password and encryption key are never deliberately persisted in browser storage or sent to Supabase. The active key is non-exportable.
- **Tamper detection:** authenticated data binds each ciphertext to its account, path, version and purpose. Modified/swapped ciphertext, wrong passwords, mismatched file sizes and unsupported versions fail closed. Encrypted metadata cannot override a record's path, owner, ID or encryption flags.
- **Owner-only access:** private storage plus restrictive account policies for records, vault configuration, cleanup paths and storage objects. Anonymous and cross-account reads/writes/deletes are blocked even if a broad permissive policy is added. Property objects cannot be overwritten through normal client updates. Vault parameters cannot be reset/deleted by normal clients, preventing accidental permanent lockout.
- **Encrypted writes:** new/updated document rows must use encryption version 1, encrypted metadata and generic fields. Storage uploads are limited to ciphertext MIME type and random encrypted paths. Cryptographic correctness is verified by the app; SQL cannot infer whether arbitrary bytes supplied by a modified client are genuine ciphertext.
- **Session privacy:** locking removes the document UI and active key references. The vault locks on leaving Documents, hiding the app, page hiding, sign-out/account change/password recovery, or five minutes of inactivity. Suspended timers are checked again on focus/activity. Late downloads cannot open a plaintext preview after locking. Preview URLs are revoked and active preview/download requests are aborted.
- **Caching and rendering:** storage downloads request `cache: no-store`; ciphertext uploads use zero cache lifetime. The service worker only caches public app assets. PDF previews use the local canvas reader; decrypted original links in new tabs have been removed. Explicit downloads are decrypted copies and the UI explains that they leave the vault.
- **Browser defenses:** production builds have a Content Security Policy permitting local scripts and named API endpoints, blocking JavaScript eval, inline scripts, objects, frames and form navigation. WebAssembly compilation and inline styles remain permitted for PDF rendering and existing UI styles. Referrer information is disabled. Cloudflare Pages receives anti-framing, MIME-sniffing and permission headers through `public/_headers`. GitHub Pages does not support this custom headers file; its HTML CSP still applies, but anti-framing requires hosting that can send response headers.
- **Configuration:** both builds and runtime reject known Supabase secret/service-role key formats before creating the browser client. A previously published secret must be rotated; a code guard cannot revoke credentials or remove earlier downloaded bundles.

## Recovery and limits

There is no vault-password reset or recovery service. Resetting the login password preserves the encrypted vault but does not unlock it. Losing the vault password means losing access to these encrypted documents. Version 1 does not provide an in-app vault-password rotation flow. Keep the password and any document backups securely.

Encryption does not guarantee that nobody can hack the system. An attacker controlling the device, browser extensions or published application code can read documents while the owner unlocks/uses them. Strong login security, a unique vault password, trusted HTTPS hosting and protected administrator accounts remain necessary. A weak/reused vault password can be guessed offline by an attacker who obtains the salt and ciphertext; the derivation cost slows guesses but cannot prevent them.

Service-role/database administrators bypass RLS. After conversion they can obtain encrypted bytes and structural metadata, but decrypting document contents requires the vault password/key. They can still delete, corrupt or roll back records and replace application code if they control the host. SQL RLS does not protect against a database administrator.

Old plaintext copies in provider backups, object versions, earlier browser caches, prior downloads, emailed attachments or other devices are outside this conversion. Removing the active original does not erase every historical copy. Decrypted downloads remain on the device after the vault locks, and JavaScript cannot guarantee immediate physical erasure of browser memory. No production penetration test or live bucket/configuration audit has been performed.

## Verification

Automated tests cover cryptographic round trips, non-exportable keys, unique random values, wrong passwords, tampering/context swapping, plaintext/metadata rejection, private upload payloads, failed conversion preservation, locked and stale download behavior, key/session expiry, setup confirmation and retryable durable cleanup. SQL tests run the migrations and verify owner/anonymous policies, immutable keys/files, encrypted-write checks and transactional cleanup. Run `npm test` and `npm run build` before deployment.

Implementation references: [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control), [private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [MDN AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), and [OWASP PBKDF2 work factors](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
