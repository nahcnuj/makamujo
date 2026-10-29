FROM python:3.12-bookworm

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY ansible/requirements.txt ansible/requirements.txt
RUN pip install --no-cache-dir -r ansible/requirements.txt

RUN curl -fsSL https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun ci


RUN bunx playwright install --with-deps chromium

ENTRYPOINT ["bash"]
CMD ["-c", "sleep infinity"]
