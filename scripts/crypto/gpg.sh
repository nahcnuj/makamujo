#!/bin/sh
set -eu
cmd=${1:-}
dek=${2:-}
case "$cmd" in
available) command -v gpg >/dev/null 2>&1 ;;
encrypt)
    [ -n "$dek" ] || exit 1
    gpg --batch --yes --quiet \
        --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 \
        --compress-algo none \
        3<<PASS
$dek
PASS
    ;;
decrypt)
    [ -n "$dek" ] || exit 1
    gpg --batch --yes --quiet \
        --passphrase-fd 3 \
        --decrypt \
        3<<PASS
$dek
PASS
    ;;
*)
    echo "usage: $0 available|encrypt|decrypt [dek]" >&2
    exit 2
    ;;
esac
