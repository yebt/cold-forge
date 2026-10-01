#!/usr/bin/env bash
# One-time setup for .github/workflows/firebase-deploy.yml: lets GitHub Actions deploy Firestore
# rules/indexes and Cloud Functions to coldforge-work WITHOUT any service-account key.
#
# Run it ONCE in Google Cloud Shell (https://shell.cloud.google.com, gcloud is preinstalled),
# signed in as a project Owner:
#
#   curl -fsSLO https://raw.githubusercontent.com/yebt/cold-forge/main/scripts/setup-github-deploy.sh
#   bash setup-github-deploy.sh
#
# (or clone the repo there and run `bash scripts/setup-github-deploy.sh`). It is idempotent: running
# it again only re-applies the same configuration.
#
# What it creates:
#   - service account github-deploy@coldforge-work.iam.gserviceaccount.com with the least set of
#     roles `firebase deploy --only firestore,functions` needs (each one explained below);
#   - Workload Identity Pool `github` + OIDC provider `github-oidc` that trusts GitHub's OIDC tokens
#     only for repository yebt/cold-forge on refs/heads/main;
#   - permission for that repository to impersonate the service account.
#
# No JSON key is created, now or ever: GitHub exchanges its short-lived OIDC token for a short-lived
# Google token on each run. At the end it prints the two values to add as GitHub repository
# VARIABLES (Settings → Secrets and variables → Actions → Variables): GCP_WIF_PROVIDER, GCP_DEPLOY_SA.
set -euo pipefail

PROJECT_ID="coldforge-work"
EXPECTED_PROJECT_NUMBER="862693102904"
REPO="yebt/cold-forge"
BRANCH_REF="refs/heads/main"
REGION="us-central1" # functions + their Artifact Registry repository (ADMIN_REGION)
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="github"
PROVIDER_ID="github-oidc"
SECRET_ID="ADMIN_ALLOWED_EMAILS"
CUSTOM_ROLE_ID="githubDeployProjectReader"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# IAM is eventually consistent: a just-created service account can be "not found" for a few seconds.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@"; then return 0; fi
    echo "  (attempt ${attempt} failed, retrying in $((attempt * 5))s)" >&2
    sleep $((attempt * 5))
  done
  "$@"
}

log "Project ${PROJECT_ID}"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
if [[ "${PROJECT_NUMBER}" != "${EXPECTED_PROJECT_NUMBER}" ]]; then
  echo "Unexpected project number ${PROJECT_NUMBER} (expected ${EXPECTED_PROJECT_NUMBER}). Aborting." >&2
  exit 1
fi
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
APPSPOT_SA="${PROJECT_ID}@appspot.gserviceaccount.com"
MEMBER="serviceAccount:${SA_EMAIL}"

log "Enabling the APIs keyless auth needs"
# iamcredentials: mint the SA's short-lived tokens. sts: exchange GitHub's OIDC token.
# cloudresourcemanager: firebase-tools reads the project. iam: service accounts, pools, roles.
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"

log "Service account ${SA_EMAIL}"
if gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  already exists"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="GitHub Actions: Firebase deploy" \
    --description="Used only by yebt/cold-forge .github/workflows/firebase-deploy.yml through Workload Identity Federation. No keys."
fi

log "Custom role ${CUSTOM_ROLE_ID} (read the Firebase project, nothing else)"
# firebase-tools checks `firebase.projects.get` before any deploy and reads the project
# (resourcemanager.projects.get, adminSdkConfig). The predefined Firebase Viewer role would also do,
# but it grants read access across every Firebase product (data included); this role holds exactly
# those two permissions.
ROLE_PERMS="firebase.projects.get,resourcemanager.projects.get"
if ROLE_DELETED="$(gcloud iam roles describe "${CUSTOM_ROLE_ID}" --project="${PROJECT_ID}" --format='value(deleted)' 2>/dev/null)"; then
  if [[ "${ROLE_DELETED}" == "True" ]]; then
    gcloud iam roles undelete "${CUSTOM_ROLE_ID}" --project="${PROJECT_ID}" >/dev/null
  fi
  gcloud iam roles update "${CUSTOM_ROLE_ID}" --project="${PROJECT_ID}" --permissions="${ROLE_PERMS}" --stage=GA --quiet >/dev/null
  echo "  updated"
else
  gcloud iam roles create "${CUSTOM_ROLE_ID}" --project="${PROJECT_ID}" \
    --title="GitHub deploy: project reader" \
    --description="firebase.projects.get + resourcemanager.projects.get for firebase-tools (github-deploy SA)." \
    --permissions="${ROLE_PERMS}" --stage=GA >/dev/null
  echo "  created"
fi

log "Project-level roles"
# Each role and why `firebase deploy --only firestore,functions` needs it at project level
# (resources it creates don't exist yet, so these can't be narrowed to one resource):
PROJECT_ROLES=(
  # Firestore rules: create rulesets, update the cloud.firestore release, prune old rulesets.
  "roles/firebaserules.admin"
  # Firestore indexes + field overrides (firebase/firestore.indexes.json), and the database lookup.
  "roles/datastore.indexAdmin"
  # Create/update/delete functions (gen1 + gen2), upload source, and set their IAM policy
  # (the admin callables are public endpoints that check auth themselves).
  "roles/cloudfunctions.admin"
  # Gen2 functions are Cloud Run services: firebase-tools updates their settings (concurrency,
  # CPU) and sets the invoker policy (public callables, scheduler-only jobs).
  "roles/run.admin"
  # Eventarc triggers behind the Firestore onDocumentCreated functions (quota triggers).
  "roles/eventarc.admin"
  # Cloud Scheduler jobs of the scheduled functions (quotaRecountCheckIns, sweepDeletedAccounts).
  "roles/cloudscheduler.admin"
  # Read secret metadata/versions during deploy (ADMIN_ALLOWED_EMAILS is bound to the callables).
  # Viewer cannot read secret values.
  "roles/secretmanager.viewer"
  # firebase-tools checks that each required API is enabled (serviceusage.services.get/use).
  "roles/serviceusage.serviceUsageConsumer"
  # firebase.projects.get + resourcemanager.projects.get (custom role above).
  "projects/${PROJECT_ID}/roles/${CUSTOM_ROLE_ID}"
)
# Not granted on purpose:
#   - roles/cloudbuild.builds.editor: Cloud Functions runs the build with its own service agent and
#     the build service account; the deployer needs no Cloud Build permission.
#   - roles/resourcemanager.projectIamAdmin / getIamPolicy: firebase-tools only edits the project
#     policy the first time a NEW kind of trigger appears (service-agent bindings). Without read
#     access it prints a warning and continues; those bindings already exist from the first manual
#     deploy. If a future trigger type needs new ones, run that one deploy manually as Owner.
#   - Any role on Firestore data, Auth users or secret values.
for role in "${PROJECT_ROLES[@]}"; do
  echo "  ${role}"
  retry gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="${MEMBER}" --role="${role}" --condition=None --quiet >/dev/null
done

log "Resource-level roles"
# Deploying functions that run as a service account requires actAs on it. Gen2 functions (and
# their builds, Eventarc triggers and scheduler jobs) run as the default compute SA.
echo "  roles/iam.serviceAccountUser on ${COMPUTE_SA}"
retry gcloud iam service-accounts add-iam-policy-binding "${COMPUTE_SA}" --project="${PROJECT_ID}" \
  --member="${MEMBER}" --role="roles/iam.serviceAccountUser" --condition=None --quiet >/dev/null
# The gen1 onUserDeleted trigger runs as the App Engine default SA when the project has one, and
# firebase-tools checks actAs on it before every functions deploy.
if gcloud iam service-accounts describe "${APPSPOT_SA}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  roles/iam.serviceAccountUser on ${APPSPOT_SA}"
  retry gcloud iam service-accounts add-iam-policy-binding "${APPSPOT_SA}" --project="${PROJECT_ID}" \
    --member="${MEMBER}" --role="roles/iam.serviceAccountUser" --condition=None --quiet >/dev/null
else
  echo "  (no ${APPSPOT_SA}: skipped)"
fi
# The deploy grants the functions' runtime SA secretAccessor on ADMIN_ALLOWED_EMAILS (setIamPolicy
# on the secret). Admin on this ONE secret only, never on the project. It also lets the deploy
# read that secret's value; nothing else in the project.
echo "  roles/secretmanager.admin on secret ${SECRET_ID}"
retry gcloud secrets add-iam-policy-binding "${SECRET_ID}" --project="${PROJECT_ID}" \
  --member="${MEMBER}" --role="roles/secretmanager.admin" --condition=None --quiet >/dev/null
# firebase-tools reads (and, if missing, sets) the cleanup policy of the functions' container
# repository, and deletes stale gen1 build images there. Scoped to that repository only.
if gcloud artifacts repositories describe gcf-artifacts --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  roles/artifactregistry.admin on repository ${REGION}/gcf-artifacts"
  retry gcloud artifacts repositories add-iam-policy-binding gcf-artifacts --location="${REGION}" --project="${PROJECT_ID}" \
    --member="${MEMBER}" --role="roles/artifactregistry.admin" --quiet >/dev/null
else
  echo "  (repository ${REGION}/gcf-artifacts not found: deploy functions once, then re-run this script)"
fi

log "Workload Identity Pool ${POOL_ID}"
POOL_STATE="$(gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global --project="${PROJECT_ID}" --format='value(state)' 2>/dev/null || true)"
if [[ -z "${POOL_STATE}" ]]; then
  gcloud iam workload-identity-pools create "${POOL_ID}" --location=global --project="${PROJECT_ID}" \
    --display-name="GitHub Actions" --description="OIDC tokens from GitHub Actions (yebt/cold-forge)"
elif [[ "${POOL_STATE}" == "DELETED" ]]; then
  gcloud iam workload-identity-pools undelete "${POOL_ID}" --location=global --project="${PROJECT_ID}"
else
  echo "  already exists (${POOL_STATE})"
fi

log "OIDC provider ${PROVIDER_ID} (only ${REPO} on ${BRANCH_REF})"
ISSUER="https://token.actions.githubusercontent.com"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.workflow=assertion.workflow,attribute.actor=assertion.actor"
# Tokens from any other repository, fork, branch, tag or pull request are rejected here, before
# any IAM check.
CONDITION="assertion.repository=='${REPO}' && assertion.ref=='${BRANCH_REF}'"
PROVIDER_STATE="$(gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" --workload-identity-pool="${POOL_ID}" \
  --location=global --project="${PROJECT_ID}" --format='value(state)' 2>/dev/null || true)"
if [[ "${PROVIDER_STATE}" == "DELETED" ]]; then
  gcloud iam workload-identity-pools providers undelete "${PROVIDER_ID}" --workload-identity-pool="${POOL_ID}" \
    --location=global --project="${PROJECT_ID}"
  PROVIDER_STATE="ACTIVE"
fi
if [[ -z "${PROVIDER_STATE}" ]]; then
  retry gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --workload-identity-pool="${POOL_ID}" --location=global --project="${PROJECT_ID}" \
    --display-name="GitHub OIDC" --issuer-uri="${ISSUER}" \
    --attribute-mapping="${MAPPING}" --attribute-condition="${CONDITION}"
else
  # Re-apply so the trust settings always match this script.
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_ID}" \
    --workload-identity-pool="${POOL_ID}" --location=global --project="${PROJECT_ID}" \
    --issuer-uri="${ISSUER}" --attribute-mapping="${MAPPING}" --attribute-condition="${CONDITION}"
fi

log "Let ${REPO} impersonate ${SA_EMAIL}"
PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${REPO}"
retry gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" --project="${PROJECT_ID}" \
  --member="${PRINCIPAL_SET}" --role="roles/iam.workloadIdentityUser" --condition=None --quiet >/dev/null

PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
cat <<EOF

Done. No service-account key was created (none is needed).

Add these two repository VARIABLES (not secrets) in GitHub:
  https://github.com/${REPO}/settings/variables/actions  →  New repository variable

  GCP_WIF_PROVIDER = ${PROVIDER_NAME}
  GCP_DEPLOY_SA    = ${SA_EMAIL}

Then re-run "Firebase deploy" from the Actions tab (or push to main). Every later push to main that
touches firebase/, apps/functions/ or the packages they bundle deploys automatically.
EOF
