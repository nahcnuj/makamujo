FROM python:3.12-bookworm
# WHY: Ansible is not installed here—it runs on the CI host against this container; this image stays a minimal Debian/Python base.

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg
