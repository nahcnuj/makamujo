#!/usr/bin/env python3

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
GAME_AREA_WIDTH = 1024
EXPECTED_CENTER = GAME_AREA_WIDTH / 2
CENTER_TOLERANCE = 24
BOARD_CENTER_TOLERANCE = 16
MIN_CONTENT_PIXELS = 4000
MIN_BOARD_PIXELS = 4000
MIN_HUD_PIXELS = 1000
BRIGHTNESS_THRESHOLD = 45
CONTENT_ROWS = (80, 400)
BOARD_ROWS = (240, 400)
HUD_ROWS = (100, 180)
MAX_ATTEMPTS = 90
RETRY_SECONDS = 2
MIN_FRAME_SSIM = 0.95
STREAM_URL = os.environ.get(
    "RTMPS_CAPTURE_URL", "rtmps://127.0.0.1:1936/live/stream"
)


def decode_rgb(path):
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    expected_size = FRAME_WIDTH * FRAME_HEIGHT * 3
    if result.returncode != 0 or len(result.stdout) != expected_size:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"could not decode {path} as {FRAME_WIDTH}x{FRAME_HEIGHT} RGB: {detail}")
    return result.stdout


def measure(pixels, rows):
    count = 0
    weighted_x = 0.0
    left = GAME_AREA_WIDTH
    right = -1
    y0, y1 = rows
    for y in range(y0, y1):
        row_offset = y * FRAME_WIDTH * 3
        for x in range(GAME_AREA_WIDTH):
            offset = row_offset + x * 3
            brightness = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3
            if brightness < BRIGHTNESS_THRESHOLD:
                continue
            count += 1
            weighted_x += x + 0.5
            left = min(left, x)
            right = max(right, x)
    if count == 0:
        return 0, 0.0, left, right, 0.0
    return count, weighted_x / count, left, right, (left + right + 1) / 2


def centering_failures(pixels):
    failures = []
    content_count, content_center, _, content_right, content_extent = measure(
        pixels, CONTENT_ROWS
    )
    if content_count < MIN_CONTENT_PIXELS:
        failures.append(f"game content is missing ({content_count} bright pixels)")
    if content_right >= GAME_AREA_WIDTH:
        failures.append(f"game content spills into the comment area (right={content_right})")
    if content_count > 0 and abs(content_center - EXPECTED_CENTER) > CENTER_TOLERANCE:
        failures.append(
            f"game content is off-center (center={content_center:.1f}, expected={EXPECTED_CENTER:.0f})"
        )
    if content_count > 0 and abs(content_extent - EXPECTED_CENTER) > CENTER_TOLERANCE:
        failures.append(
            f"game content bounds are off-center (bounds={content_extent:.1f}, expected={EXPECTED_CENTER:.0f})"
        )

    board_count, board_center, _, board_right, board_extent = measure(pixels, BOARD_ROWS)
    if board_count < MIN_BOARD_PIXELS:
        failures.append(f"game board is missing ({board_count} bright pixels)")
    if board_count > 0 and abs(board_center - EXPECTED_CENTER) > BOARD_CENTER_TOLERANCE:
        failures.append(
            f"game board is off-center (center={board_center:.1f}, expected={EXPECTED_CENTER:.0f})"
        )
    if board_count > 0 and abs(board_extent - EXPECTED_CENTER) > BOARD_CENTER_TOLERANCE:
        failures.append(
            f"game board bounds are off-center (bounds={board_extent:.1f}, expected={EXPECTED_CENTER:.0f})"
        )
    if board_count > 0 and board_right >= GAME_AREA_WIDTH:
        failures.append(f"game board spills into the comment area (right={board_right})")

    hud_count, _, _, _, hud_extent = measure(pixels, HUD_ROWS)
    if hud_count < MIN_HUD_PIXELS:
        failures.append(f"content between the title and board is missing ({hud_count} bright pixels)")
    if hud_count > 0 and abs(hud_extent - EXPECTED_CENTER) > CENTER_TOLERANCE:
        failures.append(
            f"content between the title and board is off-center "
            f"(bounds={hud_extent:.1f}, expected={EXPECTED_CENTER:.0f})"
        )
    return failures


def restart_game_browser():
    try:
        probe = subprocess.run(
            ["docker", "compose", "ps", "-q", "makamujo"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        return
    if probe.returncode != 0 or not probe.stdout.strip():
        return
    subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "makamujo",
            "systemctl",
            "set-environment",
            "VIGILANT_FIESTA_TITLE_DWELL_MS=0",
            "GAME_ACTIVITY_TIMEOUT_MS=7200000",
        ],
        check=True,
    )
    subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "makamujo",
            "systemctl",
            "restart",
            "makamujo-browser.service",
        ],
        check=True,
    )


def capture_frame(path):
    if path.exists():
        path.unlink()
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            STREAM_URL,
            "-frames:v",
            "1",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0 or not path.is_file():
        return None
    try:
        return decode_rgb(path)
    except RuntimeError:
        path.unlink(missing_ok=True)
        return None


def frame_ssim(left, right):
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-i",
            str(left),
            "-i",
            str(right),
            "-lavfi",
            "[0:v][1:v]ssim",
            "-f",
            "null",
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        return 0.0
    match = re.search(r"All:([0-9.]+)", result.stderr.decode("utf-8", "replace"))
    return float(match.group(1)) if match else 0.0


def main():
    if len(sys.argv) != 2:
        print("usage: check-game-centering.py FRAME.png", file=sys.stderr)
        return 2
    if not STREAM_URL.startswith("rtmps://"):
        print(f"VRT requires an rtmps:// stream URL (got {STREAM_URL})", file=sys.stderr)
        return 1
    restart_game_browser()
    actual = Path(sys.argv[1])
    failures = ["could not capture a centered play-start frame"]
    with tempfile.TemporaryDirectory() as temp_dir:
        previous = Path(temp_dir) / "previous.png"
        for _ in range(MAX_ATTEMPTS):
            pixels = capture_frame(actual)
            if pixels is None:
                failures = ["could not capture a 1280x720 RTMPS frame"]
            else:
                failures = centering_failures(pixels)
                if not failures:
                    if previous.is_file() and frame_ssim(previous, actual) >= MIN_FRAME_SSIM:
                        print(
                            f"VRT: captured centered play-start frame from {STREAM_URL}"
                        )
                        return 0
                    previous.write_bytes(actual.read_bytes())
            time.sleep(RETRY_SECONDS)

    for failure in failures:
        print(f"VRT: {failure}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
