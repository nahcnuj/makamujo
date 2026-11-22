# See https://aka.ms/vscode-remote/devcontainer.json for format
FROM mcr.microsoft.com/devcontainers/base:2.2-debian12

ARG USERNAME=vscode
ENV BUN_INSTALL=/usr/local
ENV NICONAMA_WATCH_PAGE_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-noto-cjk \
        git \
        libcap2-bin \
        openssl \
        unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Bun system-wide.
RUN curl -fsSL https://bun.sh/install | bash \
    && chmod +x /usr/local/bin/bun

# Install project dependencies (lockfile-respecting).
COPY --chown=${USERNAME}:${USERNAME} package.json bun.lock /workspaces/makamujo/
USER ${USERNAME}
RUN cd /workspaces/makamujo && /usr/local/bin/bun ci

# Install system dependencies required by Playwright's Chromium.
USER root
RUN /usr/local/bin/bun /workspaces/makamujo/node_modules/.bin/playwright install-deps chromium \
    && chown -R ${USERNAME}:${USERNAME} /workspaces/makamujo

# Install Playwright's Chromium browser.
USER ${USERNAME}
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
RUN bun /workspaces/makamujo/node_modules/.bin/playwright install chromium

# Generate the self-signed TLS certificate used by console E2E tests.
COPY --chown=${USERNAME}:${USERNAME} scripts /workspaces/makamujo/scripts
RUN bash /workspaces/makamujo/scripts/setup-e2e-tls.sh

# Configure git hooks from a stable, image-baked location.
COPY --chown=${USERNAME}:${USERNAME} .githooks /usr/local/share/makamujo-githooks
RUN chmod -R a+rX /usr/local/share/makamujo-githooks \
    && git config --global core.hooksPath /usr/local/share/makamujo-githooks

# Install opencode CLI.
RUN curl -fsSL https://opencode.ai/install | bash

# Install the conahcnuj driver so auto-drive can run inside this container.
# Runs as ${USERNAME}: no root needed (files are owned by the user).
RUN git clone --depth 1 https://github.com/conahcnuj/conahcnuj.git /tmp/conahcnuj \
    && mkdir -p /home/${USERNAME}/.config/opencode/gh-app /home/${USERNAME}/.config/opencode/plugins/lib \
              /home/${USERNAME}/.local/bin /home/${USERNAME}/.local/gh-app /home/${USERNAME}/.local/lib \
    && cp /tmp/conahcnuj/gh-app/*.sh /home/${USERNAME}/.config/opencode/gh-app/ \
    && cp /tmp/conahcnuj/gh-app/*.sh /home/${USERNAME}/.local/gh-app/ \
    && cp /tmp/conahcnuj/gh-app/app.env.example /home/${USERNAME}/.config/opencode/gh-app/app.env.example \
    && cp /tmp/conahcnuj/gh-app/app.env.example /home/${USERNAME}/.local/gh-app/app.env.example \
    && ( [ -f /tmp/conahcnuj/gh-app/missing-models ] && cp /tmp/conahcnuj/gh-app/missing-models /home/${USERNAME}/.config/opencode/gh-app/missing-models && cp /tmp/conahcnuj/gh-app/missing-models /home/${USERNAME}/.local/gh-app/missing-models ) || true \
    && cp /tmp/conahcnuj/plugins/gh-app-token.ts /home/${USERNAME}/.config/opencode/plugins/ \
    && cp /tmp/conahcnuj/plugins/lib/gh-app-commit.ts /home/${USERNAME}/.config/opencode/plugins/lib/ \
    && cp /tmp/conahcnuj/bin/conahcnuj.sh /home/${USERNAME}/.local/bin/conahcnuj \
    && cp /tmp/conahcnuj/bin/git-vc /home/${USERNAME}/.local/bin/git-vc \
    && chmod +x /home/${USERNAME}/.local/bin/conahcnuj /home/${USERNAME}/.local/bin/git-vc \
    && cp /tmp/conahcnuj/lib/*.sh /home/${USERNAME}/.local/lib/ \
    && ( [ ! -f /home/${USERNAME}/.config/opencode/AGENTS.md ] && cp /tmp/conahcnuj/opencode/AGENTS.md /home/${USERNAME}/.config/opencode/AGENTS.md ) || true \
    && ( [ ! -f /home/${USERNAME}/.local/gh-app/app.env ] && cp /home/${USERNAME}/.local/gh-app/app.env.example /home/${USERNAME}/.local/gh-app/app.env ) || true \
    && ( [ ! -f /home/${USERNAME}/.config/opencode/gh-app/app.env ] && cp /home/${USERNAME}/.config/opencode/gh-app/app.env.example /home/${USERNAME}/.config/opencode/gh-app/app.env ) || true \
    && rm -rf /tmp/conahcnuj

ENV PATH="${BUN_INSTALL}/bin:/home/${USERNAME}/.opencode/bin:/home/${USERNAME}/.local/bin:${PATH}"
