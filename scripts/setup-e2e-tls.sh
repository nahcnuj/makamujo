#!/bin/bash
# Generate a self-signed TLS certificate for console E2E tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}/../var/e2e-tls"
KEY_PATH="${CERT_DIR}/privkey.pem"
CERT_PATH="${CERT_DIR}/fullchain.pem"

mkdir -p "${CERT_DIR}"
# MSYS_NO_PATHCONV=1 prevents Git Bash from converting /CN=... to a Windows path
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -days 7 -nodes -subj '/CN=localhost'
chmod 600 "${KEY_PATH}"
chmod 644 "${CERT_PATH}"

printf 'Generated E2E TLS assets:\n'
printf '  CONSOLE_TLS_KEY=%s\n' "${KEY_PATH}"
printf '  CONSOLE_TLS_CERT=%s\n' "${CERT_PATH}"
