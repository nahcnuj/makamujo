# Reproduce the production makamujo streaming server in a Debian 13 (trixie) container.
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd systemd-sysv \
        openssh-server \
        python3 \
        curl ca-certificates git \
        unzip \
        iproute2 tcpdump \
        procps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Bun runtime (production uses Bun).
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /opt/src/makamujo
COPY . /opt/src/makamujo

RUN mkdir -p /run/sshd \
    && echo 'root:root' | chpasswd \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

EXPOSE 22 7777 8777 443

VOLUME ["/sys/fs/cgroup"]

CMD ["/sbin/init"]
