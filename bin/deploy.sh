#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${VPS_SSH_HOST:?VPS_SSH_HOST is required}"

ansible_user="${VPS_SSH_USER:-root}"
key_file="${ANSIBLE_SSH_PRIVATE_KEY_FILE:-${HOME}/.ssh/id_deploy}"

export ANSIBLE_HOST_KEY_CHECKING="${ANSIBLE_HOST_KEY_CHECKING:-True}"
export ANSIBLE_SSH_COMMON_ARGS="${ANSIBLE_SSH_COMMON_ARGS:--o IdentitiesOnly=yes}"

cd "$(dirname "$0")"

exec ansible-playbook "${script_dir}/../ansible/playbooks/2_makamujo.yml" \
  --vault-password-file "${script_dir}/../ansible/.vault_pass" \
  -e "ansible_host=${VPS_SSH_HOST}" \
  -e "ansible_user=${ansible_user}" \
  -e "ansible_ssh_private_key_file=${key_file}" \
  "$@"
