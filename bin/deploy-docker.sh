#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
ansible_dir="${repo_root}/ansible"

image_name="${DOCKER_IMAGE_NAME:-makamujo-debian13}"
container_name="${DOCKER_CONTAINER_NAME:-makamujo-vps}"
ssh_port="${DOCKER_SSH_PORT:-2222}"
app_port="${DOCKER_APP_PORT:-7777}"

key_dir="$(mktemp -d)"
key_file="${key_dir}/id_ed25519"
trap 'rm -rf "${key_dir}"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "${key_file}" -C "makamujo-docker" >/dev/null

docker build -t "${image_name}" "${repo_root}"

if docker container inspect "${container_name}" >/dev/null 2>&1; then
  docker rm -f "${container_name}" >/dev/null
fi

docker run -d \
  --name "${container_name}" \
  --privileged \
  --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p "${ssh_port}:22" \
  -p "${app_port}:7777" \
  "${image_name}" >/dev/null

for _ in $(seq 1 120); do
  if docker exec "${container_name}" true >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "${container_name}" sh -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh' >/dev/null
docker cp "${key_file}.pub" "${container_name}:/root/.ssh/authorized_keys" >/dev/null
docker exec "${container_name}" sh -c 'chown root:root /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' >/dev/null

for _ in $(seq 1 120); do
  if ssh -i "${key_file}" \
       -o StrictHostKeyChecking=no \
       -o UserKnownHostsFile=/dev/null \
       -o ConnectTimeout=2 \
       -p "${ssh_port}" \
       root@127.0.0.1 true >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [ ! -f "${ansible_dir}/.vault_pass" ]; then
  if [ -n "${ANSIBLE_VAULT_PASSWORD:-}" ]; then
    printf '%s\n' "${ANSIBLE_VAULT_PASSWORD}" > "${ansible_dir}/.vault_pass"
  else
    printf '%s\n' "docker" > "${ansible_dir}/.vault_pass"
  fi
  chmod 600 "${ansible_dir}/.vault_pass"
fi

export VPS_SSH_HOST=127.0.0.1
export VPS_SSH_USER=root
export ANSIBLE_SSH_PRIVATE_KEY_FILE="${key_file}"
export ANSIBLE_HOST_KEY_CHECKING=False

DEPLOY_PLAYBOOK=ansible/playbooks/0_ssh_honeypot.yml bash "${script_dir}/deploy.sh" -e "ansible_port=${ssh_port}"
bash "${script_dir}/deploy.sh" -e "ansible_port=${ssh_port}"

echo "Container ${container_name} is ready."
echo "Shell: docker exec -it ${container_name} bash"
echo "App: http://127.0.0.1:${app_port}/"
