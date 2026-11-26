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

# Install PowerShell (pwsh) so conahcnuj's install.ps1 can run in this image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget apt-transport-https \
    && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/packages-microsoft-prod.deb \
    && dpkg -i /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/packages-microsoft-prod.deb

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
# Follow conahcnuj's install.ps1 (the documented install path) instead of
# hand-copying files, so the deployed layout matches a native install.
RUN LATEST_TAG="$(git ls-remote --tags --sort=-v:refname https://github.com/conahcnuj/conahcnuj.git | head -n 1 | cut -f 2 | sed 's#^refs/tags/##; s/\^{}$//')" \
    && test -n "$LATEST_TAG" \
    && git clone --depth 1 --branch "$LATEST_TAG" https://github.com/conahcnuj/conahcnuj.git /tmp/conahcnuj \
    && pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File /tmp/conahcnuj/install.ps1 \
         -Destination /home/${USERNAME}/.config/opencode \
         -InstallPath /home/${USERNAME}/.local/bin \
    && rm -rf /tmp/conahcnuj

ENV PATH="${BUN_INSTALL}/bin:/home/${USERNAME}/.opencode/bin:/home/${USERNAME}/.local/bin:${PATH}"
