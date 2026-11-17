#!/usr/bin/env bash
set -euo pipefail

# Point the OBS instance provisioned by Ansible at the RTMPS server on the
# Docker network and switch its scene to a deterministic browser fixture.
# This is reproduction-only wiring: the production playbooks are untouched.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

container=${1:?container name is required}
rtmps_url=${RTMPS_URL:-rtmps://mediamtx:1936/live/stream}
fixture_url=${FIXTURE_URL:-http://127.0.0.1:8899/fixture.html}
fixture_dir=/opt/src/makamujo/tests/vrt-rtmps

docker exec "${container}" mkdir -p "${fixture_dir}"
docker cp tests/vrt-rtmps/fixture.html "${container}:${fixture_dir}/fixture.html"

# Serve the fixture from inside the container so OBS renders exactly the same
# page on every run (the game screen itself is intentionally non-deterministic).
docker exec -d "${container}" python3 -m http.server 8899 \
  --bind 127.0.0.1 --directory "${fixture_dir}"

for _ in $(seq 1 30); do
  if docker exec "${container}" python3 -c \
    'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8899/fixture.html", timeout=2).close()' \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -i "${container}" python3 - "${rtmps_url}" "${fixture_url}" <<'PY'
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

rtmps_url, fixture_url = sys.argv[1:3]
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

scene = json.loads(scene_path.read_text(encoding="utf-8"))
for source in scene.get("sources", []):
    if source.get("id") == "scene":
        for item in source.get("settings", {}).get("items", []):
            item["visible"] = item.get("name") == "Comment"
        continue
    source["enabled"] = source.get("name") == "Comment"
    if source.get("name") == "Comment":
        source["settings"]["url"] = fixture_url
        source["settings"]["fps"] = 30
        source["settings"]["fps_custom"] = True
        source["settings"].pop("css", None)
        source.pop("filters", None)
scene_path.write_text(
    json.dumps(scene, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
PY

docker exec "${container}" systemctl restart makamujo-obs.service
echo "OBS is streaming the VRT fixture to ${rtmps_url}"
