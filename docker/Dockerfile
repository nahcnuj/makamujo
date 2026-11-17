# Reproduce the production makamujo streaming server in a Debian 13 (trixie) container.
# Base image tags: debian:13, debian:trixie
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive

# systemd as PID 1 so the production units (makamujo.service, ...) can run.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd systemd-sysv \
        openssh-server \
        python3 \
        ca-certificates curl git \
        iproute2 tcpdump procps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Allow Ansible to connect locally.
RUN mkdir -p /run/sshd \
    && echo 'root:root' | chpasswd \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

EXPOSE 22 7777 8777 443

VOLUME ["/sys/fs/cgroup"]

CMD ["/sbin/init"]
