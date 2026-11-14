# Debian 13 (Trixie) container that mirrors the production OS for reproduction.
FROM debian:13.7

ENV DEBIAN_FRONTEND=noninteractive

# Minimal systemd-enabled container for deployment-target reproduction.
# Remaining packages are installed by Ansible (see ansible/playbooks).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        python3 \
        openssh-server \
        fonts-noto-cjk \
        fonts-ipafont-gothic \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

VOLUME ["/sys/fs/cgroup"]
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]

# Enable sshd at boot for Ansible/CD-style provisioning.
RUN ln -sf /lib/systemd/system/ssh.service /etc/systemd/system/multi-user.target.wants/ssh.service

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD systemctl is-active ssh.service >/dev/null 2>&1 || exit 1
