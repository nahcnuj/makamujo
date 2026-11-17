#!/usr/bin/env bash
set -euo pipefail

# VRT setup for the Docker/Ansible reproduction: make OBS publish the actual
# vigilant-fiesta game stream to the RTMPS server on the Docker network.
# The scene source is the real game page (not a synthetic fixture); only the
# ad slots are hidden so the captured frame is reproducible. Production
# playbooks and the OBS installation are left untouched.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

container=${1:?container name is required}
rtmps_url=${RTMPS_URL:-rtmps://mediamtx:1936/live/stream}
game_url=${VRT_GAME_URL:-https://www.nahcnuj.work/vigilant-fiesta/}

# OBS saves its in-memory settings when it exits. Stopping it *before*
# rewriting the config is essential: a plain restart lets the old process
# overwrite service.json / the scene collection on shutdown, and the new
# process then keeps streaming the original Niconama configuration.
docker exec "${container}" systemctl stop makamujo-obs.service
for _ in $(seq 1 30); do
  if ! docker exec "${container}" systemctl is-active --quiet makamujo-obs.service; then
    break
  fi
  sleep 1
done
if docker exec "${container}" systemctl is-active --quiet makamujo-obs.service; then
  echo "OBS did not stop before rewriting its configuration" >&2
  exit 1
fi

docker exec -i "${container}" python3 - "${rtmps_url}" "${game_url}" <<'PY'
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

rtmps_url, game_url = sys.argv[1:3]
service_path = Path("/opt/src/makamujo/obs-studio/basic/profiles/Makamujo/service.json")
scene_path = Path("/opt/src/makamujo/obs-studio/basic/scenes/Makamujo.json")

# OBS treats "server" as the URL prefix and appends "key" as the stream name.
# Keep the published path equal to the URL the VRT capture reads.
url = urlsplit(rtmps_url)
stream_key = url.path.rstrip("/").rsplit("/", 1)[-1]
server_prefix = url._replace(path=url.path.rstrip("/")[: -len(stream_key)].rstrip("/")).geturl()

service = {
    "type": "rtmp_custom",
    "settings": {
        "server": server_prefix,
        "key": stream_key,
        "use_auth": False,
        "bwtest": False,
    },
}
service_path.write_text(
    json.dumps(service, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)

# Show only the browser source, pointed at the real game. Ads are dynamic and
# would make the visual comparison flaky, so hide their slots via browser
# source CSS. Both the OBS frame and the committed baseline use this CSS.
vrt_css = " ".join(
    [
        "#ad-side-left, #ad-side-right, .ad-slot, ins.adsbygoogle { display: none !important; }",
        "html, body { width: 1280px !important; height: 720px !important; overflow: hidden !important; }",
    ]
)

scene = json.loads(scene_path.read_text(encoding="utf-8"))
for source in scene.get("sources", []):
    if source.get("id") == "scene":
        for item in source.get("settings", {}).get("items", []):
            item["visible"] = item.get("name") == "Comment"
        continue
    source["enabled"] = source.get("name") == "Comment"
    if source.get("name") == "Comment":
        source["settings"]["url"] = game_url
        source["settings"]["fps"] = 30
        source["settings"]["fps_custom"] = True
        source["settings"]["css"] = vrt_css
        source.pop("filters", None)
scene_path.write_text(
    json.dumps(scene, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
PY

docker exec "${container}" systemctl start makamujo-obs.service
for _ in $(seq 1 30); do
  if docker exec "${container}" systemctl is-active --quiet makamujo-obs.service; then
    echo "OBS is streaming vigilant-fiesta (${game_url}) to ${rtmps_url}"
    exit 0
  fi
  sleep 1
done

docker exec "${container}" systemctl status makamujo-obs.service --no-pager -l >&2 || true
echo "OBS failed to start after rewriting its configuration" >&2
exit 1
