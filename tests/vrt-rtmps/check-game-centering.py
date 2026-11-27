#!/usr/bin/env python3

import subprocess
import sys

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
GAME_AREA_WIDTH = 1024
EXPECTED_CENTER = GAME_AREA_WIDTH / 2
CENTER_TOLERANCE = 24
MIN_CONTENT_PIXELS = 4000
MIN_HUD_PIXELS = 1000
BRIGHTNESS_THRESHOLD = 45
CONTENT_ROWS = (80, 400)
HUD_ROWS = (100, 180)


def decode_rgb(path):
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
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
        return 0, 0.0, left, right
    return count, weighted_x / count, left, right


def main():
    if len(sys.argv) != 2:
        print("usage: check-game-centering.py FRAME.png", file=sys.stderr)
        return 2

    try:
        pixels = decode_rgb(sys.argv[1])
    except RuntimeError as error:
        print(f"VRT: {error}", file=sys.stderr)
        return 1

    failures = []
    content_count, content_center, _, content_right = measure(pixels, CONTENT_ROWS)
    if content_count < MIN_CONTENT_PIXELS:
        failures.append(f"game content is missing ({content_count} bright pixels)")
    if content_right >= GAME_AREA_WIDTH:
        failures.append(f"game content spills into the comment area (right={content_right})")
    if content_count > 0 and abs(content_center - EXPECTED_CENTER) > CENTER_TOLERANCE:
        failures.append(
            f"game content is off-center (center={content_center:.1f}, expected={EXPECTED_CENTER:.0f})"
        )

    hud_count, _, _, _ = measure(pixels, HUD_ROWS)
    if hud_count < MIN_HUD_PIXELS:
        failures.append(f"content between the title and board is missing ({hud_count} bright pixels)")

    if failures:
        for failure in failures:
            print(f"VRT: {failure}", file=sys.stderr)
        return 1

    print(f"VRT: game content center={content_center:.1f} (expected {EXPECTED_CENTER:.0f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
