FROM python:3.12-bookworm
# WHY: Ansible runs on the CI host (installed via pip); this image stays a minimal Debian/Python base.

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg
