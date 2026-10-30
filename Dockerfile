# Debian 13 (trixie): reproduce the VPS streaming server for Visual Regression Testing.
# Container contents are provisioned with Ansible, like production.
FROM debian:13

ARG DEBIAN_FRONTEND=noninteractive

# Install Ansible and the tooling needed to provision the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ansible \
      python3 \
      ca-certificates \
      curl \
      git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/src/makamujo

# Copy the application source into the image.
COPY . /opt/src/makamujo

# Deploy the container contents with Ansible, the same way the VPS is deployed.
RUN cd /opt/src/makamujo/ansible \
 && printf 'vps ansible_host=localhost ansible_connection=local\n' > /tmp/hosts.ini \
 && ansible-playbook playbooks/docker.yml -i /tmp/hosts.ini

# Runtime defaults for the streaming server.
ENV NODE_ENV=production \
    CONSOLE_LOOPBACK_ONLY=1 \
    NICONAMA_WATCH_PAGE_DISABLED=1 \
    PORT=7777 \
    DISPLAY=:99 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Bun is installed by Ansible under /root/.bun.
ENV PATH="/root/.bun/bin:${PATH}"

EXPOSE 7777

CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 & export DISPLAY=:99; exec bun index.ts --port 7777"]
