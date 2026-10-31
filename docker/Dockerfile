# Debian 13 (Trixie) container that mirrors the production OS for reproduction.
# Base matches production: Debian 13 (trixie).
FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive

# systemd-enabled container for deployment-target reproduction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        python3 \
        sudo \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        iproute2 \
        procps \
        tcpdump \
        ffmpeg \
        openssh-server \
        openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

VOLUME ["/sys/fs/cgroup"]
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]

# Enable sshd at boot for Ansible/CD-style provisioning.
RUN ln -sf /lib/systemd/system/ssh.service /etc/systemd/system/multi-user.target.wants/ssh.service
