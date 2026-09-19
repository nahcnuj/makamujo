#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
work_dir=$(mktemp -d)
cleanup() {
  rm -rf "${work_dir}"
}
trap cleanup EXIT

cat > "${work_dir}/fail2ban.log" <<'EOF'
2026-09-19 03:11:44,000 fail2ban.filter   [321]: INFO    [sshd] Found 203.0.113.5 - 2026-09-19 03:11:44
2026-09-19 03:11:45,123 fail2ban.actions  [321]: NOTICE  [sshd] Ban 203.0.113.5
2026-09-19 03:11:50,000 fail2ban.filter   [321]: INFO    [sshd] Found 203.0.113.5 - 2026-09-19 03:11:49
2026-09-19 05:02:13,001 fail2ban.actions  [321]: NOTICE  [sshd] 203.0.113.5 already banned
2026-09-19 06:00:00,000 fail2ban.filter   [321]: INFO    [sshd] Found 198.51.100.7 - 2026-09-19 06:00:00
2026-09-19 06:00:15,500 fail2ban.actions  [321]: NOTICE  [sshd] Ban 198.51.100.7
Sep 19 06:10:00 vps fail2ban.filter[450]: INFO    [sshd] Found 192.0.2.9 - 2026-09-19 06:10:01
Sep 19 06:10:03 vps fail2ban.actions[450]: NOTICE  [sshd] Ban 192.0.2.9
2026-09-19 07:00:00,000 fail2ban.filter   [321]: INFO    [sshd] Found 10.0.0.99 - 2026-09-19 07:00:00
2026-09-19 06:20:00,000 fail2ban.filter   [321]: INFO    [sshd] Found beef - 203.0.113.9
2026-09-19 06:20:03,001 fail2ban.actions  [321]: NOTICE  [sshd] Ban 203.0.113.9
EOF

# request receive time is the first Found event; caught = BAN - request
report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" \
  --ip 203.0.113.5 --now "$(date -d '2026-09-19 03:11:45' +%s)" \
  "${work_dir}/fail2ban.log")
[ "${report}" = '[sshd] caught 203.0.113.5 for 1s since 2026-09-19 03:11:44' ] || {
  echo "203.0.113.5 record mismatch: ${report}" >&2
  exit 1
}

# syslog-format log lines and stdin input are handled too
report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" \
  --ip 192.0.2.9 --now "$(date -d 'Sep 19 06:10:03' +%s)" \
  - <"${work_dir}/fail2ban.log")
[ "${report}" = '[sshd] caught 192.0.2.9 for 2s since 2026-09-19 06:10:01' ] || {
  echo "192.0.2.9 record mismatch: ${report}" >&2
  exit 1
}

report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" \
  --ip 198.51.100.7 --now "$(date -d '2026-09-19 06:00:15' +%s)" \
  "${work_dir}/fail2ban.log")
[ "${report}" = '[sshd] caught 198.51.100.7 for 15s since 2026-09-19 06:00:00' ] || {
  echo "198.51.100.7 record mismatch: ${report}" >&2
  exit 1
}

# an IP with no Found event falls back to 0s instead of failing
report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" \
  --ip 198.51.100.254 --now 0 "${work_dir}/fail2ban.log")
[ "${report}" = '[sshd] caught 198.51.100.254 for 0s (no Found event in log)' ] || {
  echo "no-Found record mismatch: ${report}" >&2
  exit 1
}

# a username that looks like hex ("beef") is not mistaken for the address
report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" \
  --ip 203.0.113.9 --now "$(date -d '2026-09-19 06:20:03' +%s)" \
  "${work_dir}/fail2ban.log")
[ "${report}" = '[sshd] caught 203.0.113.9 for 3s since 2026-09-19 06:20:00' ] || {
  echo "beef username record mismatch: ${report}" >&2
  exit 1
}

# --ip is required
if bash "${PROJECT_ROOT}/bin/honeypot-report" - </dev/null >/dev/null 2>&1; then
  echo "--ip is required" >&2
  exit 1
fi

echo "honeypot-report output ok"