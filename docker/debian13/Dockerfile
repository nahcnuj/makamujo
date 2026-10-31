# Debian 13 (Trixie) container that mirrors the production OS for Ansible reproduction.
# Base matches production: Debian 13 (trixie).
FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive

# systemd-enabled container (geerlingguy/cisagov style) for Ansible.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        python3 \
        python3-apt \
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
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Ansible (system package) for in-container reproduction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ansible \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

VOLUME ["/sys/fs/cgroup"]
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
