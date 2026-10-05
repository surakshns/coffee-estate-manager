#!/usr/bin/env bash
# Redeploy only the reminder functions and their imported shared modules.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy-reminder-functions.sh PROJECT_REF
       SUPABASE_PROJECT_REF=PROJECT_REF ./scripts/deploy-reminder-functions.sh

Prerequisites: Supabase CLI authentication (supabase login / npx supabase login),
or SUPABASE_ACCESS_TOKEN supplied securely by your CI environment.
With npx, use Node.js 20 or later. Existing server secrets and reminder database
migrations must already be configured. This script does not change them.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# > 1 )); then
  usage >&2
  exit 2
fi

project_ref="${1:-${SUPABASE_PROJECT_REF:-}}"
if [[ ! "$project_ref" =~ ^[a-z0-9]{20}$ ]]; then
  printf '%s\n' 'Provide the 20-character Supabase project reference from Project Settings.' >&2
  usage >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"
cd -- "$repo_dir"

for source_file in \
  supabase/config.toml \
  supabase/functions/estate-reminders/index.ts \
  supabase/functions/send-estate-reminders/index.ts \
  supabase/functions/_shared/reminderRuntime.ts \
  supabase/functions/_shared/requestBody.ts; do
  if [[ ! -f "$source_file" ]]; then
    printf 'Required source file is missing: %s\n' "$source_file" >&2
    exit 1
  fi
done

if command -v supabase >/dev/null 2>&1; then
  cli=(supabase)
elif command -v npx >/dev/null 2>&1; then
  cli=(npx supabase)
else
  printf '%s\n' 'Install the Supabase CLI or Node.js 20+ before deploying.' >&2
  exit 1
fi

"${cli[@]}" --version
printf 'Redeploying reminder functions to project %s\n' "$project_ref"

# The management function validates the session with Auth.getUser. The sender
# verifies its private x-reminder-secret. Keep gateway JWT checks disabled for
# these two handlers, matching supabase/config.toml. --use-api bundles imports
# server-side, including _shared modules, without requiring local Docker.
for function_name in estate-reminders send-estate-reminders; do
  printf 'Deploying %s...\n' "$function_name"
  "${cli[@]}" functions deploy "$function_name" \
    --project-ref "$project_ref" \
    --use-api \
    --no-verify-jwt
done

printf '%s\n' 'Both reminder functions deployed successfully. Existing secrets and cron job were kept.'
