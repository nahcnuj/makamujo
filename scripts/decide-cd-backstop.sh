#!/usr/bin/env bash
#
# Pure decision function for the CD backstop (#677 / #683).
#
# Usage:
#   decide-cd-backstop.sh <head_sha> <deployed_shas> <cd_runs_in_flight>
#
#   head_sha            HEAD sha of the branch to deploy ("" when unresolvable)
#   deployed_shas       newline-separated shas that already have a deployment
#   cd_runs_in_flight   number of queued/running CD runs for head_sha
#
# Prints exactly one action:
#   skip-unknown    the branch HEAD could not be resolved; do nothing
#   skip-deployed   head_sha already has a deployment
#   skip-in-flight  a CD run for head_sha is queued or running
#   dispatch        cd.yml should be dispatched for head_sha
#
# This script performs no I/O so it can be exercised directly; scripts/cd-backstop.sh
# is the thin wrapper that talks to `gh`.
set -euo pipefail

head_sha="${1-}"
deployed_shas="${2-}"
cd_runs_in_flight="${3-0}"

if [ -z "${head_sha}" ]; then
  echo "skip-unknown"
  exit 0
fi

if [ -n "${deployed_shas}" ] && grep -Fxq -- "${head_sha}" <<<"${deployed_shas}"; then
  echo "skip-deployed"
  exit 0
fi

if [ "${cd_runs_in_flight}" -gt 0 ]; then
  echo "skip-in-flight"
  exit 0
fi

echo "dispatch"