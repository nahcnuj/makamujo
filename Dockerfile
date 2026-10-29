FROM python:3.12-bookworm

WORKDIR /workspace

ENV ANSIBLE_CONFIG=/workspace/ansible/ansible.cfg

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        unzip \
        chromium \
        fonts-noto-cjk \
        fonts-ipafont-gothic \
        fonts-ipafont-mincho \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pip install --no-cache-dir -r ansible/requirements.txt

RUN curl -fsSL https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:${PATH}"

RUN bun ci

RUN bunx playwright install --with-deps chromium
