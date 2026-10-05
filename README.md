# Coffee Estate Manager

A responsive coffee estate bookkeeping application for labour payments, expenses, market prices, harvests, sales and CSV backups. The React + TypeScript + Vite + Tailwind CSS frontend uses Supabase Auth, a database with account-level Row Level Security, private document storage, and Edge Functions for scheduled reminders.

## Included features

- Dashboard: harvest quantities, calendar-year sales, spending, recorded balance, worker loans and charts
- Floating Coffee Estate Guide: a reusable January–December seasonal reference with your own notes and CSV backup
- Weekly labour tracker: historical weekly payment snapshots, worker defaults, and active/inactive workers
- Configurable expense categories with monthly, annual, and per-category totals
- Coffee benchmark futures prices with saved history, live refresh and CSV download
- Harvest and sales records with remaining stock, crop revenue and separate calendar-year activity
- CSV backups with multiline notes, validation and review before import
- Email/password sign-in, password changes, and email password recovery via Supabase Auth
- Supabase Row Level Security policies so each account can only access its own records
- Encrypted property document vault with a separate password, encrypted file details and automatic locking
- Destructive-action confirmations and large, clear mobile controls
- Lazy-loaded screens, background record refresh, progressive lists and reduced-motion support
- Calculation, workflow, account-isolation and security regression tests

## Requirements

- Node.js 20 or newer
- A free Supabase account and project

## 1. Create a Supabase project

1. Go to [Supabase](https://supabase.com/dashboard) and create a project.
2. In **Authentication → Providers**, ensure Email is enabled. For simple local testing, you may turn off **Confirm email** under **Authentication → Providers → Email**.
3. In **SQL Editor**, paste and run the full contents of:

   `supabase/migrations/202609130001_estate_schema.sql`

   This creates the tables, indexes, user-creation trigger, default categories, seed functions, and Row Level Security policies.
   If you ran an earlier version and sample data reports a `record "new" has no field "worker_id"` error, run the corrective migration `supabase/migrations/202609130002_fix_reference_validation.sql` once in SQL Editor.
   If sample data then reports a duplicate `coffee_prices_user_id_source_external_id_key` error, run `supabase/migrations/202609130003_fix_manual_price_uniqueness.sql` once in SQL Editor.
   Run later migrations in filename order as well. The Coffee Estate Guide requires both `supabase/migrations/202609140006_monthly_planner.sql` and `supabase/migrations/202609140007_evergreen_estate_guide.sql`. Weekly days worked and yearly daily pay rates require `supabase/migrations/202609140008_joint_loans_and_daily_rates.sql`.
4. Open **Connect** near the top of the Supabase project dashboard and copy the Project URL and **Publishable key** (`sb_publishable_...`). On an older project, the equivalent legacy value is called the **anon** key. Never put a secret/service-role key in this app.

## 2. Configure and run locally

Open the project folder in VS Code, then run:

```bash
cp .env.example .env
npm install
npm run dev
```

Edit `.env` and add your own values:

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key-here
```

Vite prints a URL such as `http://localhost:5173`. Open it in your browser. On the sign-in screen, create an account. The database trigger will automatically create the four default expense categories: Irrigation, Manure, Shade Lopping, and Miscellaneous.

## Optional demo data

After you sign in, press **Load sample records** on the empty dashboard. The RPC writes sample data only to the authenticated user’s account. Alternatively, in the Supabase SQL Editor, use the sample call in `supabase/seed.sql` and replace the placeholder with an Auth user UUID.

## Tests and production build

```bash
npm test
npm run build
```

Tests cover weekly pay, linked loan deductions, account changes, paginated data loading, financial periods, CSV imports, documents, reminders, public offline caching and request validation. Deployment runs the tests before building. SQL regression checks in `supabase/tests` are intended for a local/test database with all migrations applied.

## CSV backup and import

The **Backup & import** screen exports all years for each record type. Document files are downloaded separately from Documents. CSVs preserve multiline notes and escape formula-like text for spreadsheet opening; app imports restore that text.

Choose a CSV to validate and review before importing (up to 5 MB and 10,000 records). Matching worker/category names, worker-and-Wednesday payments, and yearly daily rates update existing records; the preview reports those updates. Other record types append records, so importing the same file twice creates duplicates.

Restore workers and categories first, then worker loans, then weekly payments and expenses. Weekly imports reconcile linked loan deductions atomically and leave the imported week ready for review in Labour. Import matching worker names only when each name identifies one worker.

## Deploy to Cloudflare Pages

1. Push this folder to a GitHub or GitLab repository.
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**.
3. Use these build settings:

   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. In **Settings → Environment variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production (and Preview if desired).
5. Deploy. `public/_redirects` makes direct links resolve to the single-page app.
6. Configure Supabase **Authentication → URL Configuration** with your deployed Site URL and the password recovery redirect described below.

## Deploy to GitHub Pages

The project includes `.github/workflows/deploy-pages.yml`, which builds and deploys automatically when you push to the `main` branch.

1. Create a new GitHub repository named `coffee-estate-manager`. A public repository is the simplest option for GitHub Pages. The Supabase **publishable** key is designed to be exposed in browser apps; your RLS policies protect the actual data.
2. Push this project to the new repository.
3. On GitHub, open the repository → **Settings → Pages**. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Open **Settings → Secrets and variables → Actions → Variables**. Add both repository variables:

   - `VITE_SUPABASE_URL` — your Supabase Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — the key starting with `sb_publishable_`

5. Push a commit (or open **Actions → Deploy Coffee Estate Manager to GitHub Pages → Run workflow**). When the workflow finishes, GitHub displays your public `https://YOUR-USERNAME.github.io/coffee-estate-manager/` URL.
6. Configure Supabase **Authentication → URL Configuration** with your deployed Site URL and the password recovery redirect described below.

Do not add a `sb_secret_...` key, a service-role key, or your local `.env` file to GitHub.

## Future Capacitor packaging

The app uses only frontend browser APIs and Supabase’s official JavaScript client. To package it later:

```bash
npm run build
npx cap init "Coffee Estate Manager" "com.yourestate.manager"
npx cap add android
npx cap add ios
npx cap sync
```

Install Capacitor packages only when you are ready to produce a mobile store build. No code in this project relies on a custom server, so the same Supabase configuration works in a Capacitor app.

## Data and security notes

- The app uses the public Supabase anon/publishable key by design. Security comes from Supabase Auth and the RLS policies in the migration.
- Do not disable RLS and do not expose a service-role key in `VITE_*` variables.
- Property documents use client-side encryption plus private storage. Apply the vault migration before publishing this version, then create your vault password and encrypt existing files. Save the vault password: login password recovery cannot recover encrypted documents. Follow [the document vault setup and security notes](docs/document-vault-security.md).
- Currency display is Indian Rupees (`₹`). Change the `money` helper in `src/lib/calculations.ts` if your estate uses another currency.
- Fractional rupees retain paise. Crop revenue includes all sales assigned to a harvest year; calendar-year activity uses sale and expense dates. Recorded balance excludes inventory valuation, unpaid invoices, depreciation and crop cost allocation.

## Worker days and editing saved weeks

Run `supabase/migrations/202609140009_worker_days_and_weekly_updates.sql` after the existing migrations. It adds a default of 5 working days per worker (editable from 0–6) and a transaction for saving or updating wages and their linked loan deductions together. Saved weeks have **Edit weekly payments**, **Save updates**, and **Cancel editing** actions. The migration does not change existing wage records.

## Login passwords and recovery

- On the sign-in page, **Forgot password?** sends a reset link to the account email. The link opens a new-password form in the app; expired links let the user request another email.
- Signed-in users can choose **Change password** from the header's **More options** or the phone's **More** menu. The app verifies the current password before updating it. Both flows ask the user to confirm their new password and support email verification codes if the Supabase project requires reauthentication.
- No database migration is needed for these account features. Supabase Auth manages the passwords.

In Supabase **Authentication → URL Configuration**, set **Site URL** to your deployed app URL, then add the matching password recovery URL to **Redirect URLs**:

- Local: `http://localhost:5173/?auth=recovery` (add the `127.0.0.1` equivalent if you use that host).
- Cloudflare or a custom domain: `https://YOUR-APP-DOMAIN/?auth=recovery`.
- GitHub Pages: `https://YOUR-USERNAME.github.io/coffee-estate-manager/?auth=recovery`.

The app builds this URL from its origin and Vite base path, so it keeps the GitHub Pages repository path. Keep the reset email template's default `{{ .ConfirmationURL }}` link so Supabase verifies the link before redirecting. See [Supabase's redirect URL documentation](https://supabase.com/docs/guides/auth/redirect-urls) for the allow-list setup. Check your project's email delivery settings if recovery emails do not arrive.

## Mobile weekly pay and worker loan accounts

Weekly pay has attendance buttons, worker search, and a sticky save bar. Search only changes which workers are visible; saving still includes the entire week. Saved payments stay locked until you choose **Edit this week**. Worker loans show one account per worker with outstanding/settled filters and a separate statement for advances, direct repayments, and weekly deductions.

Before using this version, run `supabase/migrations/202610040001_remove_joint_loans.sql` in the Supabase SQL Editor after all earlier migrations. It replaces the weekly payment save function, adds an atomic clear-week function, and removes the unused joint-loan tables and validation function. It stops without changing anything if either joint-loan table contains records. Individual worker loans, yearly daily rates, and saved wages are preserved.

## Editable advance reminders

The phone Menu and desktop More options have **Advance reminder**, and the desktop Labour page has **Edit reminder**. Choose the weekday and time in India time, turn the account reminder on or off, and connect each phone separately. The default is Wednesday at 8 PM. Reminders start on the selected day and repeat daily at the selected time until the full weekly payment is saved. Rescheduling sends a confirmation to connected phones. Notifications open the exact Wednesday and protect any existing unsaved weekly-pay draft.

Scheduled delivery requires the new migration, deployed Edge Functions, server push keys and a Supabase Cron job. Follow [the reminder setup guide](docs/advance-reminders-setup.md). Until setup is complete, the app shows that delivery is unavailable and lets you save a disabled schedule preference. Checkout/build alone does not enable notifications.

## Record integrity update — 5 October 2026

Apply `supabase/migrations/202610050004_record_integrity.sql` after all earlier migrations before deploying this frontend. It adds financial/document checks, two record indexes, and the atomic `import_weekly_payments` function. Existing legacy records remain untouched; new or updated records must satisfy the checks.

Redeploy both reminder Edge Functions to include bounded request parsing and complete status counts, then publish the new frontend and service worker. See [the code review](docs/code-review-2026-10-05.md) for the changes, verification and operational limits.

## Encrypted property documents — 5 October 2026

Also apply `supabase/migrations/202610050005_encrypted_document_vault.sql` before publishing the frontend. It creates owner-only vault settings, enforces encrypted document writes, keeps storage private, and queues original-file removal durably. Existing documents require conversion after creating a vault password in Documents; the migration preserves them for that step. Read [the activation steps and security limits](docs/document-vault-security.md) before treating existing files as encrypted.
