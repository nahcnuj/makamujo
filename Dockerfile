FROM debian:bookworm-20261027

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        python3 \
        unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun ci && \
    bunx playwright install --with-deps chromium

ENTRYPOINT ["bash"]
CMD ["-c", "sleep infinity"]
