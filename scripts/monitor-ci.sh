#!/usr/bin/env bash
set -eu

echo "Starting persistent CI monitor for branch: fix/issue-210"

LAST_ID=""

while true; do
  RUN_INFO=$(gh run list --repo nahcnuj/makamujo --branch fix/issue-210 --limit 1 --json databaseId,createdAt,url --jq '.[] | (.databaseId|tostring) + "|" + (.createdAt) + "|" + .url' 2>/dev/null || true)
  if [ -z "${RUN_INFO}" ] || [ "${RUN_INFO}" = "null" ]; then
    echo "$(date -u +%FT%TZ) no run found, retrying..."
    sleep 10
    continue
  fi

  RUN_DBID=${RUN_INFO%%|*}
  rest=${RUN_INFO#*|}
  RUN_CREATED=${rest%%|*}
  RUN_URL=${rest#*|}
  RUN_ID=${RUN_URL##*/}

  if [ "${RUN_ID}" != "${LAST_ID}" ]; then
    echo "$(date -u +%FT%TZ) new run detected id=${RUN_ID} createdAt=${RUN_CREATED}"
    LAST_ID=${RUN_ID}
  fi

  STATUS_CONCLUSION=$(gh run view "${RUN_ID}" --repo nahcnuj/makamujo --json status,conclusion --jq '.status + " " + (.conclusion // "")' 2>/dev/null || echo "unknown unknown")
  STATUS=$(echo "${STATUS_CONCLUSION}" | awk '{print $1}')
  CONCLUSION=$(echo "${STATUS_CONCLUSION}" | awk '{print $2}')

  echo "$(date -u +%FT%TZ) run=${RUN_ID} status=${STATUS} conclusion=${CONCLUSION}"

  if [ "${STATUS}" = "completed" ] && [ "${CONCLUSION}" = "success" ]; then
    echo "RUN_SUCCESS ${RUN_ID}"
    exit 0
  fi

  sleep 10
done
