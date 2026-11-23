#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Test case: capture a frame of the vigilant-fiesta stream
# received by the RTMPS server and write it next to this script as
# capture-rtmps.png. The stream is published by the OBS instance in the
# reproduced production container; no synthetic image is generated here.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

out_file=${1:-"$(dirname "$0")/capture-rtmps.png"}
stream_url=${RTMPS_CAPTURE_URL:-rtmps://127.0.0.1:1936/live/stream}

# Restart the browser service (when available) so the capture begins from the
# deterministic title screen instead of a mid-game frame.
if [ "${RTMPS_RESTART_BROWSER:-1}" = "1" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -qx 'makamujo'; then
    docker compose exec -T makamujo systemctl set-environment VIGILANT_FIESTA_TITLE_DWELL_MS=3600000 >/dev/null 2>&1 || true
    docker compose exec -T makamujo systemctl set-environment VRT_MODE=1 >/dev/null 2>&1 || true
    docker compose exec -T makamujo systemctl restart makamujo-screen.service >/dev/null 2>&1 || true
    sleep 8
    docker compose exec -T makamujo bash -c 'curl -s http://127.0.0.1:7777/ | grep -o vrt-mode || echo NO_VRT_META' || true
    docker compose exec -T makamujo bash -c 'systemctl is-active makamujo-screen.service makamujo-browser.service makamujo-obs.service' || true
    # VRT_MODE=1 (set above) makes the server inject the vrt-mode meta tag,
    # so the default page is already in VRT mode; no OBS URL override needed.
    docker compose exec -T makamujo systemctl restart makamujo-browser.service >/dev/null 2>&1 || true
    sleep 8
    docker compose exec -T makamujo systemctl restart makamujo-obs.service >/dev/null 2>&1 || true
    sleep 12
  fi
fi

# The regression must exercise the encrypted RTMPS path. A plain RTMP URL or a
# local file would make the comparison pass without testing the reproduction.
case "${stream_url}" in
  rtmps://*) ;;
  *)
    echo "RTMPS VRT requires an rtmps:// stream URL (got ${stream_url})" >&2
    exit 1
    ;;
esac

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is required" >&2
  exit 1
fi

# OBS may take a while to come up after provisioning. Retry until a real
# 1280x720 frame is available. The reproduced overlay is animated, so also
# require two consecutive 1280x720 frames to be nearly identical before
# accepting one. This skips transitional frames that would otherwise make the
# SSIM comparison flaky.
error_log=$(mktemp)
prev_frame=$(mktemp --suffix=.png)
trap 'rm -f "${error_log}" "${prev_frame}"' EXIT
first_error=''
attempts=0
max_attempts=90
while [ "${attempts}" -lt "${max_attempts}" ]; do
  rm -f "${out_file}"
  if ffmpeg -hide_banner -loglevel error -nostdin -y \
      -i "${stream_url}" -frames:v 1 "${out_file}" 2>"${error_log}" \
      && [ -s "${out_file}" ]; then
    dimensions=$(ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height -of csv=s=x:p=0 "${out_file}")
    if [ "${dimensions}" = "1280x720" ]; then
      # Reject all-black frames (OBS not yet rendering the page).
      if ! python3 - "${out_file}" <<'PY' >/dev/null 2>&1; then
import struct, zlib, sys
d = open(sys.argv[1], "rb").read()
assert d[:8] == b"\x89PNG\r\n\x1a\n"
off = 8; w = h = 0; raw = bytearray()
while off < len(d):
    ln = struct.unpack(">I", d[off:off+4])[0]
    typ = d[off+4:off+8]; chunk = d[off+8:off+8+ln]; off += 12 + ln
    if typ == b"IHDR":
        w, h = struct.unpack(">II", chunk[:8]); bd, ct = chunk[8], chunk[9]
    elif typ == b"IDAT":
        raw += chunk
    elif typ == b"IEND":
        break
bpp = 3 if ct == 2 else 4 if ct == 6 else 1
stride = w * bpp
dec = zlib.decompress(bytes(raw))
prev = bytearray(stride)
pos = 0
nonblack = False
for y in range(h):
    filt = dec[pos]; pos += 1
    row = bytearray(dec[pos:pos+stride]); pos += stride
    for i in range(stride):
        left = row[i-bpp] if i >= bpp else 0
        up = prev[i]
        ul = prev[i-bpp] if i >= bpp else 0
        if filt == 0: val = row[i]
        elif filt == 1: val = (row[i] + left) & 255
        elif filt == 2: val = (row[i] + up) & 255
        elif filt == 3: val = (row[i] + ((left + up) // 2)) & 255
        elif filt == 4:
            a, b, c = left, up, ul
            p = a + b - c
            pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
            pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            val = (row[i] + pr) & 255
        else:
            val = row[i]
        row[i] = val
    prev = row
    for i in range(0, stride, bpp):
        if row[i] != 0 or row[i+1] != 0 or row[i+2] != 0:
            nonblack = True
            break
    if nonblack:
        break
sys.exit(0 if nonblack else 1)
PY
        attempts=$((attempts + 1))
        sleep 1
        continue
      fi
      if [ -s "${prev_frame}" ]; then
        if cmp -s "${prev_frame}" "${out_file}"; then
          echo "Captured RTMPS frame to ${out_file}"
          exit 0
        fi
        ssim_log=$(mktemp)
        if ffmpeg -hide_banner -nostdin -i "${prev_frame}" -i "${out_file}" \
            -lavfi '[0:v][1:v]ssim' -f null - >/dev/null 2>"${ssim_log}"; then
          score=$(grep -o 'All:[0-9.]*' "${ssim_log}" | tail -n 1 | cut -d: -f2 || true)
          rm -f "${ssim_log}"
          if [ -n "${score}" ] && awk -v score="${score}" 'BEGIN { exit !(score >= 0.95) }'; then
            echo "Captured RTMPS frame to ${out_file}"
            exit 0
          fi
        else
          rm -f "${ssim_log}"
        fi
      fi
      cp "${out_file}" "${prev_frame}"
    else
      echo "Unexpected captured frame size: ${dimensions}" >&2
    fi
  elif [ -z "${first_error}" ] && [ -s "${error_log}" ]; then
    first_error=$(<"${error_log}")
  fi
  attempts=$((attempts + 1))
  sleep 1
done

echo "Failed to capture a 1280x720 frame from ${stream_url}" >&2
if [ -n "${first_error}" ]; then
  echo "First ffmpeg error:" >&2
  printf '%s\n' "${first_error}" >&2
fi
exit 1
