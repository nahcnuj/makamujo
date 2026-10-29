FROM python:3.12-bookworm

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY ansible/ ansible/
COPY bin/makamujo-pipewire bin/makamujo-audio.sh bin/
RUN pip install --no-cache-dir -r ansible/requirements.txt \
    && ansible-playbook -i 'vps,' -c local -e ansible_become=false \
       ansible/playbooks/0_desktop.yml --tags vrt \
    && ansible-playbook -i 'vps,' -c local -e ansible_become=false \
       ansible/playbooks/1_bun.yml

ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun ci
RUN bunx playwright install --with-deps chromium

COPY . .
