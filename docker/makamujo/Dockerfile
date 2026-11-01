# Debian 13 (Trixie) container that mirrors the production OS for reproduction.
# Base matches production: Debian 13 (trixie).
FROM debian:13.7

ENV DEBIAN_FRONTEND=noninteractive

# Minimal systemd-enabled container for deployment-target reproduction.
# Remaining packages are installed by Ansible (see ansible/playbooks).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        python3 \
        sudo \
        ca-certificates \
        openssh-server \
        openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

VOLUME ["/sys/fs/cgroup"]
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]

# Enable sshd at boot and generate host keys for Ansible/CD-style provisioning.
RUN systemctl enable ssh.service && ssh-keygen -A

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD systemctl is-active ssh.service >/dev/null 2>&1 || exit 1
