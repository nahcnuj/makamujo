# See https://aka.ms/vscode-remote/devcontainer.json for format
FROM mcr.microsoft.com/devcontainers/base:2.2-debian12

ARG USERNAME=vscode
ENV BUN_INSTALL=/usr/local
WORKDIR /workspaces/makamujo

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        libcap2-bin \
        openssl \
        unzip \
        fonts-noto-cjk \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Bun system-wide.
RUN curl -fsSL https://bun.sh/install | bash \
    && chmod +x /usr/local/bin/bun

# Install project dependencies (lockfile-respecting).
COPY --chown=${USERNAME}:${USERNAME} package.json bun.lock /workspaces/makamujo/
RUN chown -R ${USERNAME}:${USERNAME} /workspaces/makamujo
USER ${USERNAME}
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
RUN bun ci

# Install system dependencies required by Playwright's Chromium.
USER root
RUN bun /workspaces/makamujo/node_modules/.bin/playwright install-deps chromium

# Install Playwright's Chromium browser.
USER ${USERNAME}
RUN bun /workspaces/makamujo/node_modules/.bin/playwright install chromium

# Generate the self-signed TLS certificate used by console E2E tests.
COPY --chown=${USERNAME}:${USERNAME} scripts /workspaces/makamujo/scripts
RUN bash /workspaces/makamujo/scripts/setup-e2e-tls.sh

# Configure git hooks from a stable, image-baked location.
COPY --chown=${USERNAME}:${USERNAME} .githooks /usr/local/share/makamujo-githooks
USER root
RUN chmod +x /usr/local/share/makamujo-githooks/* \
    && git config --system core.hooksPath /usr/local/share/makamujo-githooks
USER ${USERNAME}
