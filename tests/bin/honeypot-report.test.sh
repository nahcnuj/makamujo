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
EOF

report_from_file=$(bash "${PROJECT_ROOT}/bin/honeypot-report" "${work_dir}/fail2ban.log")

report_from_stdin=$(bash "${PROJECT_ROOT}/bin/honeypot-report" - <"${work_dir}/fail2ban.log")

for report in "${report_from_file}" "${report_from_stdin}"; do
  printf '%s\n' "${report}" | grep -q '^IP'
  printf '%s\n' "${report}" | grep -q 'caught_s'
  printf '%s\n' "${report}" | grep -Eq '^203\.0\.113\.5 ' || {
    echo "missing 203.0.113.5 row" >&2
    exit 1
  }
  printf '%s\n' "${report}" | grep -Eq '^198\.51\.100\.7 ' || {
    echo "missing 198.51.100.7 row" >&2
    exit 1
  }
  printf '%s\n' "${report}" | grep -Eq '^192\.0\.2\.9 ' || {
    echo "missing 192.0.2.9 row" >&2
    exit 1
  }
  printf '%s\n' "${report}" | grep -E '203\.0\.113\.5' | grep -qE ' 1$' || {
    echo "203.0.113.5 caught_s is not 1: $(printf '%s\n' "${report}" | grep 203.0.113.5)" >&2
    exit 1
  }
  printf '%s\n' "${report}" | grep -E '198\.51\.100\.7' | grep -qE ' 15$' || {
    echo "198.51.100.7 caught_s is not 15: $(printf '%s\n' "${report}" | grep 198.51.100.7)" >&2
    exit 1
  }
  printf '%s\n' "${report}" | grep -E '192\.0\.2\.9' | grep -qE ' 2$' || {
    echo "192.0.2.9 caught_s is not 2: $(printf '%s\n' "${report}" | grep 192.0.2.9)" >&2
    exit 1
  }
  if printf '%s\n' "${report}" | grep -q '10\.0\.0\.99'; then
    echo "never-banned IP 10.0.0.99 must not be reported" >&2
    exit 1
  fi
done

empty_report=$(bash "${PROJECT_ROOT}/bin/honeypot-report" - </dev/null 2>&1 || true)
case "${empty_report}" in
  *"no banned IPs"*) ;;
  *)
    echo "empty log should fail with 'no banned IPs', got: ${empty_report}" >&2
    exit 1
    ;;
esac

echo "honeypot-report output ok"