# See https://aka.ms/vscode-remote/devcontainer.json for format
FROM mcr.microsoft.com/devcontainers/base:2.1-debian12

ARG USERNAME=vscode
WORKDIR /workspace

RUN apt-get update && rm -rf /var/lib/apt/lists/*

USER ${USERNAME}

# Install bun
RUN curl -fsSL https://bun.com/install | bash

ENV PATH="/home/${USERNAME}/.bun/bin:${PATH}"

COPY package.json bun.lock* /workspace/
