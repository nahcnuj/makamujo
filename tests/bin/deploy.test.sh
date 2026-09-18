#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
stub_dir=$(mktemp -d)
cleanup() {
  rm -rf "${stub_dir}"
  rm -f "${PROJECT_ROOT}/ansible/.vault_pass"
}
trap cleanup EXIT

export STUB_DIR="${stub_dir}"
cat > "${stub_dir}/ansible-playbook" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$@" > "${STUB_DIR}/argv"
printenv ANSIBLE_SSH_COMMON_ARGS > "${STUB_DIR}/ssh_args"
exit 0
EOF
chmod +x "${stub_dir}/ansible-playbook"

mkdir -p "${stub_dir}/.ssh"
touch "${stub_dir}/.ssh/id_deploy"
printf 'dummy\n' > "${PROJECT_ROOT}/ansible/.vault_pass"

export PATH="${stub_dir}:${PATH}"
export HOME="${stub_dir}"
export VPS_SSH_HOST=127.0.0.1
unset VPS_SSH_USER || true
unset ANSIBLE_SSH_COMMON_ARGS || true

bash "${PROJECT_ROOT}/bin/deploy.sh"

python3 - "${stub_dir}" <<'PY'
import pathlib
import sys

stub = pathlib.Path(sys.argv[1])
args = [a.decode() for a in stub.joinpath("argv").read_bytes().split(b"\0") if a]
ssh_args = stub.joinpath("ssh_args").read_text().strip()
if "-o" in args:
    raise SystemExit(f"ansible-playbook argv contains -o: {args}")
if not any(a.startswith("ansible_host=") for a in args):
    raise SystemExit(f"missing ansible_host extra-var: {args}")
if not any(a.startswith("ansible_user=root") for a in args):
    raise SystemExit(f"missing ansible_user extra-var: {args}")
if not any(a.startswith("ansible_port=") for a in args):
    raise SystemExit(f"missing ansible_port extra-var: {args}")
if "IdentitiesOnly=yes" not in ssh_args:
    raise SystemExit(f"ANSIBLE_SSH_COMMON_ARGS missing IdentitiesOnly: {ssh_args!r}")
if "ConnectTimeout=10" not in ssh_args:
    raise SystemExit(f"ANSIBLE_SSH_COMMON_ARGS missing ConnectTimeout: {ssh_args!r}")
if ssh_args.split()[0] != "-o":
    raise SystemExit(f"ANSIBLE_SSH_COMMON_ARGS should start with -o: {ssh_args!r}")
if not any(a.endswith("ansible/playbooks/2_makamujo.yml") or a.endswith("ansible\\playbooks\\2_makamujo.yml") for a in args):
    raise SystemExit(f"default playbook is not 2_makamujo.yml: {args}")
print("cd-deploy.sh argv and SSH args ok")
PY

export VPS_SSH_PORT=22222
export DEPLOY_PLAYBOOK=ansible/playbooks/0_ssh_honeypot.yml
bash "${PROJECT_ROOT}/bin/deploy.sh"

python3 - "${stub_dir}" <<'PY'
import pathlib
import sys

stub = pathlib.Path(sys.argv[1])
args = [a.decode() for a in stub.joinpath("argv").read_bytes().split(b"\0") if a]
if not any(a.startswith("ansible_port=22222") for a in args):
    raise SystemExit(f"VPS_SSH_PORT did not become ansible_port: {args}")
if not any(a.endswith("0_ssh_honeypot.yml") for a in args):
    raise SystemExit(f"DEPLOY_PLAYBOOK did not select honeypot playbook: {args}")
print("cd-deploy.sh playbook override and port override ok")
PY
