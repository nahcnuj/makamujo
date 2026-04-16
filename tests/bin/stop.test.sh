#!/usr/bin/env sh

set -eu

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

tmp_project_root=$(mktemp -d)
cleanup() {
  rm -rf "${tmp_project_root}"
}
trap cleanup EXIT

mkdir -p "${tmp_project_root}/bin" "${tmp_project_root}/var/pid" "${tmp_project_root}/fake-bin" "${tmp_project_root}/fake-state"
cp "${PROJECT_ROOT}/bin/stop" "${tmp_project_root}/bin/stop"
chmod +x "${tmp_project_root}/bin/stop"
echo "123" > "${tmp_project_root}/var/pid/screen"

cat > "${tmp_project_root}/fake-bin/kill" <<'EOS'
#!/usr/bin/env sh
set -eu

state_dir=${FAKE_STATE_DIR:?}
signal=$1
pid=$2
state_file="${state_dir}/${pid}"

if [ "${signal}" = "-KILL" ]; then
  echo 3 > "${state_file}"
  exit 0
fi

if [ "${signal}" = "-0" ]; then
  if [ ! -f "${state_file}" ]; then
    exit 1
  fi

  retries=$(cat "${state_file}")
  if [ "${retries}" -gt 0 ]; then
    echo $((retries - 1)) > "${state_file}"
    exit 0
  fi

  rm -f "${state_file}"
  exit 1
fi

exit 0
EOS
chmod +x "${tmp_project_root}/fake-bin/kill"

cat > "${tmp_project_root}/fake-bin/pgrep" <<'EOS'
#!/usr/bin/env sh
exit 1
EOS
chmod +x "${tmp_project_root}/fake-bin/pgrep"

cat > "${tmp_project_root}/bash_env" <<'EOS'
enable -n kill
EOS

started_at_ns=$(date +%s%N)
PATH="${tmp_project_root}/fake-bin:${PATH}" \
FAKE_STATE_DIR="${tmp_project_root}/fake-state" \
BASH_ENV="${tmp_project_root}/bash_env" \
bash "${tmp_project_root}/bin/stop"
elapsed_ms=$(( ($(date +%s%N) - started_at_ns) / 1000000 ))

if [ "${elapsed_ms}" -lt 200 ]; then
  echo "stop finished too early: ${elapsed_ms}ms" >&2
  exit 1
fi

if [ -f "${tmp_project_root}/var/pid/screen" ]; then
  echo "pid file was not removed" >&2
  exit 1
fi
