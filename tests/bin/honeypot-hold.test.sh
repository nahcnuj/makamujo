#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

# Needs root (via sudo) to run a throwaway sshd. Skip otherwise so the suite
# still passes on stripped-down machines.
if ! command -v sshd >/dev/null 2>&1 \
  || ! command -v ssh-keygen >/dev/null 2>&1 \
  || ! command -v ssh >/dev/null 2>&1 \
  || ! command -v sudo >/dev/null 2>&1; then
  echo "sshd/ssh/sudo unavailable; skipping honeypot-hold test"
  exit 0
fi
if ! sudo -n true 2>/dev/null; then
  echo "passwordless sudo unavailable; skipping honeypot-hold test"
  exit 0
fi

# A freshly installed openssh-server has no runtime privilege-separation
# directory yet (nothing started the service); sshd refuses to run without it.
sudo -n mkdir -p /run/sshd
SSHD_BIN=$(command -v sshd)

work_dir=$(mktemp -d)
sshd_pid=""
cleanup() {
  if [ -n "${sshd_pid}" ]; then
    sudo -n kill "${sshd_pid}" 2>/dev/null || true
  fi
  rm -rf "${work_dir}"
}
trap cleanup EXIT

port=$((30000 + (RANDOM % 20000)))
hostkey="${work_dir}/hostkey"
ssh-keygen -q -t ed25519 -N "" -f "${hostkey}"
clientkey="${work_dir}/clientkey"
ssh-keygen -q -t ed25519 -N "" -f "${clientkey}"

cat > "${work_dir}/sshd_config" <<EOF
Port ${port}
ListenAddress 127.0.0.1
HostKey ${hostkey}
PidFile ${work_dir}/sshd.pid
AuthorizedKeysFile /dev/null
UsePAM no
UseDNS no
StrictModes no
LogLevel VERBOSE
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
GSSAPIAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey
LoginGraceTime 0
MaxStartups 100000:50:100000
MaxAuthTries 100000
EOF

sudo -n "${SSHD_BIN}" -t -f "${work_dir}/sshd_config"
sudo -n "${SSHD_BIN}" -f "${work_dir}/sshd_config"
sshd_pid=$(cat "${work_dir}/sshd.pid")

# Wait until the port answers.
for _ in $(seq 1 50); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3>&-
    break
  fi
  sleep 0.1
done

# A single bogus publickey must be answered with Permission denied (so the
# handshake really happened) but the server must NEVER send a disconnect:
# LoginGraceTime 0 keeps the session and MaxAuthTries 100000 removes the
# "Too many authentication failures" cut that drops attackers instantly.
set +e
output=$(timeout 5 ssh \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o PreferredAuthentications=publickey \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=2 \
  -i "${clientkey}" \
  -p "${port}" attacker@127.0.0.1 true 2>&1)
rc=$?
set -e

if ! echo "${output}" | grep -Fq "Permission denied (publickey)"; then
  echo "key auth failure was not answered at all: ${output}" >&2
  exit 1
fi

if echo "${output}" | grep -Fq "Too many authentication failures"; then
  echo "sshd cut the failed auth session (MaxAuthTries too low)" >&2
  echo "${output}" >&2
  exit 1
fi

if echo "${output}" | grep -Fq "Disconnected from"; then
  echo "sshd initiated a disconnection on auth failure" >&2
  echo "${output}" >&2
  exit 1
fi

echo "honeypot-hold: failed key auth held without server-side cut"