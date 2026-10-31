FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus \
      openssh-server python3 python3-apt \
      sudo curl ca-certificates git iproute2 procps unzip cron \
      xvfb x11vnc pipewire pipewire-pulse wireplumber pulseaudio-utils alsa-utils \
      flatpak chromium fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && systemd-machine-id-setup 2>/dev/null || true

RUN mkdir -p /var/run/sshd /root/.ssh \
 && chmod 700 /root/.ssh \
 && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
 && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

RUN systemctl enable ssh.service
RUN systemctl mask getty@tty1.service systemd-modules-load.service 2>/dev/null || true

RUN curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

ENV BUN_INSTALL=/root/.bun
ENV PATH="/root/.bun/bin:${PATH}"


# Reproduce the subset of 0_desktop.yml / 0_obs.yml that 2_makamujo.yml assumes
# is already present on the VPS: streaming display units, PipeWire-capable
# runtime, and OBS Studio via Flatpak.
RUN cat > /etc/systemd/system/makamujo-xvfb.service <<'UNIT'
[Unit]
Description=Makamujo streaming display :10 (2560x1440)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :10 -screen 0 2560x1440x24 -ac +extension GLX +render -noreset
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
RUN cat > /etc/systemd/system/makamujo-x11vnc.service <<'UNIT'
[Unit]
Description=Makamujo x11vnc on :10
After=makamujo-xvfb.service
Requires=makamujo-xvfb.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :10 -forever -shared -rfbport 5900 -localhost -nopw -xkb
Restart=on-failure
RestartSec=2
SuccessExitStatus=2 SIGTERM

[Install]
WantedBy=multi-user.target
UNIT
RUN systemctl enable makamujo-xvfb.service makamujo-x11vnc.service 2>/dev/null || true

RUN flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
RUN flatpak install -y flathub com.obsproject.Studio

EXPOSE 22 7777 8777 443

STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
