# Reproduce the production makamujo streaming server in a Debian 13 (trixie) container.
# Base image tags: debian:13, debian:trixie
FROM debian:trixie

ENV DEBIAN_FRONTEND=noninteractive

# systemd as PID 1 so the production units (makamujo.service, ...) can run.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd systemd-sysv \
        openssh-server \
        unzip \
        python3 python3-pip \
        ansible \
        curl ca-certificates git \
        iproute2 tcpdump \
        procps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Bun runtime (production uses Bun).
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Application tree.
WORKDIR /opt/src/makamujo
COPY . /opt/src/makamujo

# Allow Ansible to connect locally.
RUN mkdir -p /run/sshd \
    && echo 'root:root' | chpasswd \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

# Provision the container like production using Ansible.
RUN cd /opt/src/makamujo/ansible \
    && printf 'vps ansible_connection=local\n' > /tmp/ansible-hosts \
    && ansible-playbook -i /tmp/ansible-hosts playbooks/2_makamujo.yml
EXPOSE 22 7777 8777 443

VOLUME ["/sys/fs/cgroup"]

CMD ["/sbin/init"]
