FROM python:3.12-bookworm

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg
