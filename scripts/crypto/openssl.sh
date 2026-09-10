#!/bin/sh
set -eu
cmd=${1:-}
dek=${2:-}
case "$cmd" in
available) command -v openssl >/dev/null 2>&1 ;;
encrypt)
    [ -n "$dek" ] || exit 1
    openssl enc -aes-256-cbc -pbkdf2 -base64 -pass "pass:$dek" 2>/dev/null
    ;;
decrypt)
    [ -n "$dek" ] || exit 1
    openssl enc -d -aes-256-cbc -pbkdf2 -base64 -pass "pass:$dek" 2>/dev/null
    ;;
*)
    echo "usage: $0 available|encrypt|decrypt [dek]" >&2
    exit 2
    ;;
esac
