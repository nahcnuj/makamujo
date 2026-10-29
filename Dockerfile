FROM python:3.12-bookworm

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r ansible/requirements.txt

RUN ANSIBLE="ansible-playbook -i ansible/inventory/hosts.yml --limit vrt -e ansible_become=false" \
    && $ANSIBLE ansible/playbooks/0_desktop.yml --tags vrt \
    && $ANSIBLE ansible/playbooks/1_bun.yml

ENV PATH="/root/.bun/bin:${PATH}"

RUN bun ci

RUN bunx playwright install --with-deps chromium
