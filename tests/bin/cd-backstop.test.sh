#!/usr/bin/env bash
# Tests for the CD backstop scripts (#677 / #683).
#
# `gh` is stubbed so the plumbing can run without a network connection. Neither
# this test nor the scripts under test needs an external jq: `gh api --jq` is
# evaluated by gh itself, and the actual decision is a pure function.
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BACKSTOP="${PROJECT_ROOT}/scripts/cd-backstop.sh"
DECIDE="${PROJECT_ROOT}/scripts/decide-cd-backstop.sh"

tmp_root=$(mktemp -d)
trap 'rm -rf "${tmp_root}"' EXIT

GH_STUB_DIR="${tmp_root}/bin"
GH_STUB_LOG="${tmp_root}/gh.log"
mkdir -p "${GH_STUB_DIR}"

HEAD_SHA=1111111111111111111111111111111111111111
OTHER_SHA=0000000000000000000000000000000000000000
ANOTHER_SHA=2222222222222222222222222222222222222222

# ---------------------------------------------------------------- pure function

expect_decision() {
  local expected="$1"
  local actual="$2"
  shift 2
  if [ "${expected}" != "${actual}" ]; then
    printf 'expected %s but got %s for args: %s\n' \
      "${expected}" "${actual}" "$*" >&2
    exit 1
  fi
}

expect_decision "dispatch" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "" 0)"
expect_decision "dispatch" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "${OTHER_SHA}
${ANOTHER_SHA}" 0)"
expect_decision "skip-deployed" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "${OTHER_SHA}
${HEAD_SHA}" 0)"
expect_decision "skip-in-flight" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "${OTHER_SHA}" 1)"
expect_decision "skip-unknown" \
  "$(bash "${DECIDE}" "" "${OTHER_SHA}" 1)"
# "already deployed" outranks "run in flight": the deploy finished, so there is
# nothing left to wait for.
expect_decision "skip-deployed" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "${HEAD_SHA}" 3)"
# A prefix of a deployed sha must not count as that commit.
expect_decision "dispatch" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "${HEAD_SHA}ff" 0)"
# Missing in-flight argument defaults to 0.
expect_decision "dispatch" \
  "$(bash "${DECIDE}" "${HEAD_SHA}" "")"

# ------------------------------------------------------------------- gh plumbing

export GH_STUB_HEAD_SHA="${HEAD_SHA}"
export GH_STUB_DEPLOYED_SHAS=""
export GH_STUB_RUN_LIST_LENGTH=0

cat > "${GH_STUB_DIR}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_STUB_LOG}"

case "$1" in
  api)
    case "$2" in
      */commits/*) printf '%s\n' "${GH_STUB_HEAD_SHA}" ;;
      */deployments*) printf '%s\n' "${GH_STUB_DEPLOYED_SHAS}" ;;
      *) echo "unexpected gh api endpoint: $*" >&2; exit 1 ;;
    esac
    ;;
  run)
    case "$2" in
      list) printf '%s\n' "${GH_STUB_RUN_LIST_LENGTH}" ;;
      *) echo "unexpected gh run subcommand: $*" >&2; exit 1 ;;
    esac
    ;;
  workflow)
    case "$2" in
      # The real `gh workflow run` prints nothing on success.
      run) : ;;
      *) echo "unexpected gh workflow subcommand: $*" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "unexpected gh subcommand: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${GH_STUB_DIR}/gh"

fail() {
  printf '%s\n' "$1" >&2
  printf -- '--- gh calls ---\n' >&2
  cat "${GH_STUB_LOG}" >&2 || true
  # The script under test writes diagnostics to stderr; without this the real
  # cause of a failure is invisible.
  if [ -s "${tmp_root}/stderr" ]; then
    printf -- '--- script stderr ---\n' >&2
    cat "${tmp_root}/stderr" >&2
  fi
  exit 1
}

expect_action() {
  local expected="$1"
  local actual="$2"
  if [ "${expected}" != "${actual}" ]; then
    fail "expected action ${expected} but got ${actual}"
  fi
}

expect_gh_call() {
  if ! grep -qF -- "$1" "${GH_STUB_LOG}"; then
    fail "expected gh to be called with: $1"
  fi
}

expect_no_gh_call() {
  if grep -qF -- "$1" "${GH_STUB_LOG}"; then
    fail "expected gh NOT to be called with: $1"
  fi
}

run_backstop() {
  : > "${GH_STUB_LOG}"
  GH_REPO="${GH_REPO_OVERRIDE:-nahcnuj/makamujo}" \
    MAIN_REF="${MAIN_REF_OVERRIDE:-main}" \
    CD_WORKFLOW="${CD_WORKFLOW_OVERRIDE:-cd.yml}" \
    DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT_OVERRIDE:-prod}" \
    PATH="${GH_STUB_DIR}:${PATH}" \
    GH_STUB_LOG="${GH_STUB_LOG}" \
    bash "${BACKSTOP}" 2> "${tmp_root}/stderr"
}

# 1. main HEAD already deployed -> skip, never dispatch.
GH_STUB_DEPLOYED_SHAS="${OTHER_SHA}
${HEAD_SHA}"
export GH_STUB_DEPLOYED_SHAS
expect_action "skip-deployed" "$(run_backstop)"
expect_no_gh_call "workflow run"

# 2. undeployed and nothing in flight -> dispatch cd.yml for main.
GH_STUB_DEPLOYED_SHAS="${OTHER_SHA}"
export GH_STUB_DEPLOYED_SHAS
expect_action "dispatch" "$(run_backstop)"
expect_gh_call "workflow run cd.yml --repo nahcnuj/makamujo --ref main"

# 3. a CD run for that commit is already in flight -> skip the duplicate.
GH_STUB_RUN_LIST_LENGTH=2
export GH_STUB_RUN_LIST_LENGTH
expect_action "skip-in-flight" "$(run_backstop)"
expect_no_gh_call "workflow run"
# A run that has not started yet reports one of these statuses.
for status in queued waiting in_progress pending; do
  expect_gh_call "--status ${status}"
done

# 4. deployments only knows other commits -> still dispatch.
GH_STUB_RUN_LIST_LENGTH=0
GH_STUB_DEPLOYED_SHAS="${OTHER_SHA}
${ANOTHER_SHA}"
export GH_STUB_DEPLOYED_SHAS GH_STUB_RUN_LIST_LENGTH
expect_action "dispatch" "$(run_backstop)"

# 5. main HEAD unresolvable -> give up without dispatching.
GH_STUB_HEAD_SHA=""
export GH_STUB_HEAD_SHA
expect_action "skip-unknown" "$(run_backstop)"
expect_no_gh_call "workflow run"

# 6. honours MAIN_REF / CD_WORKFLOW / DEPLOY_ENVIRONMENT overrides.
GH_STUB_HEAD_SHA="${HEAD_SHA}"
GH_STUB_DEPLOYED_SHAS="${OTHER_SHA}"
MAIN_REF_OVERRIDE=legacy
CD_WORKFLOW_OVERRIDE=deploy.yml
DEPLOY_ENVIRONMENT_OVERRIDE=staging
export GH_STUB_HEAD_SHA GH_STUB_DEPLOYED_SHAS
export MAIN_REF_OVERRIDE CD_WORKFLOW_OVERRIDE DEPLOY_ENVIRONMENT_OVERRIDE
expect_action "dispatch" "$(run_backstop)"
expect_gh_call "commits/legacy"
expect_gh_call "environment=staging"
expect_gh_call "workflow run deploy.yml --repo nahcnuj/makamujo --ref legacy"
unset MAIN_REF_OVERRIDE CD_WORKFLOW_OVERRIDE DEPLOY_ENVIRONMENT_OVERRIDE

# 7. missing GH_REPO fails loudly instead of guessing a repository.
if env -u GH_REPO PATH="${GH_STUB_DIR}:${PATH}" \
  bash "${BACKSTOP}" > /dev/null 2>&1; then
  fail "cd-backstop should fail when GH_REPO is unset"
fi

printf 'cd-backstop decision logic ok\n'