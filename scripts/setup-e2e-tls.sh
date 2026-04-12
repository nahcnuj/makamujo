#!/bin/bash
# Generate a self-signed TLS certificate for console E2E tests.
set -euo pipefail

sudo mkdir -p /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp
sudo openssl req -x509 -newkey rsa:2048 \
  -keyout /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem \
  -out /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem \
  -days 7 -nodes -subj '/CN=localhost'
sudo chown -R "$USER:$USER" /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp
chmod 600 /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem
chmod 644 /etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem
