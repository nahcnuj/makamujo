FROM python:3.12-bookworm
# Minimal Debian/Python base: Ansible runs on the CI host; the container only needs its interpreter.

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg
