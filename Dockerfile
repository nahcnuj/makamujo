# Reproduce the production makamujo streaming server base in a Debian 13 (trixie) container.
# Base image tags: debian:13, debian:trixie
# Provisioning is performed from outside the container (via Ansible over SSH),
# exactly like production (see bin/deploy.sh). No ports are exposed here; services
# communicate over the Docker network.
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive

# systemd as PID 1 so the production units (makamujo.service, ...) can run.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd systemd-sysv \
        openssh-server \
        python3 \
        iproute2 \
        procps dbus \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Allow Ansible to connect from outside the container.
RUN mkdir -p /run/sshd \
    && echo 'root:root' | chpasswd \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

# In production root gets XDG_RUNTIME_DIR from the systemd login session.
# Ansible runs non-login commands over SSH, so expose it through PAM here;
# otherwise flatpak cannot find the Pulse socket during provisioning.
RUN printf 'XDG_RUNTIME_DIR=/run/user/0\n' >> /etc/environment

# Bake the per-run RTMPS CA (generated in CI) into the container trust store so
# OBS and other TLS clients trust the ephemeral mediamtx certificate without a
# runtime docker compose cp / update-ca-certificates step.
COPY ca.pem /usr/local/share/ca-certificates/mediamtx-ca.crt
RUN update-ca-certificates

VOLUME ["/sys/fs/cgroup"]

CMD ["/sbin/init"]
