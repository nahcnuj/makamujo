# See https://aka.ms/vscode-remote/devcontainer.json for format
FROM mcr.microsoft.com/devcontainers/base:2.1-debian12

ARG USERNAME=vscode
ENV BUN_INSTALL=/usr/local
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libcap2-bin \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Bun system-wide.
RUN curl -fsSL https://bun.sh/install | bash \
    && chmod +x /usr/local/bin/bun

USER ${USERNAME}

ENV PATH="${BUN_INSTALL}/bin:${PATH}"

COPY package.json bun.lock* ./
