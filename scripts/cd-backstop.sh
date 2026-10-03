#!/usr/bin/env bash
#
# Dispatch CD for the current HEAD of main when it has not been deployed yet.
#
# Why this exists (#677 / #683): GitHub suppresses workflow runs triggered by
# GITHUB_TOKEN and by GitHub App installation tokens, so `on: push` never fires
# when a PR is merged by such a token. Nothing deploys that commit, and
# `cd.yml`'s own CI-dispatch fallback can never help because `cd.yml` itself
# never starts. This wrapper is the missing link: the scheduled
# cd-backstop.yml workflow calls it, and it dispatches `cd.yml` for any main
# HEAD that is neither deployed nor already in flight.
#
# `schedule` is dispatched regardless of which token made the merge, so the
# deploy path stops depending on the merge mechanism.
#
# The decision itself lives in scripts/decide-cd-backstop.sh so it can be tested
# without a network connection. Requires an authenticated `gh`.
set -euo pipefail

GH_REPO="${GH_REPO:?GH_REPO must be set (owner/repo)}"
CD_WORKFLOW="${CD_WORKFLOW:-cd.yml}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-prod}"
MAIN_REF="${MAIN_REF:-main}"

script_dir="$(cd "$(dirname "$0")" && pwd)"

log() {
  printf '[cd-backstop] %s\n' "$1" >&2
}

head_sha="$(gh api "repos/${GH_REPO}/commits/${MAIN_REF}" --jq '.sha' || true)"

# `cd.yml`'s deploy job is attached to an environment, so a deployment record
# exists for every commit it ever started deploying. That record is the
# authoritative "already shipped" marker; no extra state has to be kept.
deployed_shas="$(gh api \
  "repos/${GH_REPO}/deployments?environment=${DEPLOY_ENVIRONMENT}&per_page=100" \
  --jq '.[].sha' || true)"

# A CD run that is queued or running must not be duplicated: `cd.yml` uses a
# non-cancelling concurrency group, so a second dispatch would only pile up and
# then deploy the same commit twice.
cd_runs_in_flight="$(
  gh run list \
    --repo "${GH_REPO}" \
    --workflow "${CD_WORKFLOW}" \
    --commit "${head_sha}" \
    --limit 20 \
    --status queued \
    --status waiting \
    --status in_progress \
    --status pending \
    --json databaseId \
    --jq 'length' || printf '0'
)"

# Invoked through `bash` rather than executed directly: the scripts under
# scripts/ are tracked without the executable bit, so a direct call would fail
# with "Permission denied" on a real Linux filesystem.
action="$(bash "${script_dir}/decide-cd-backstop.sh" \
  "${head_sha}" "${deployed_shas}" "${cd_runs_in_flight:-0}")"

log "${MAIN_REF} HEAD=${head_sha:-<unresolved>} deployed_shas=$(wc -l <<<"${deployed_shas}" | tr -d ' ') in_flight=${cd_runs_in_flight:-0} action=${action}"

if [ "${action}" != "dispatch" ]; then
  echo "${action}"
  exit 0
fi

gh workflow run "${CD_WORKFLOW}" --repo "${GH_REPO}" --ref "${MAIN_REF}"
echo "dispatch"