#!/usr/bin/env python3

import subprocess
import sys

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
        return 0, 0.0, left, right, 0.0
    return count, weighted_x / count, left, right, (left + right + 1) / 2


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

    if failures:
        for failure in failures:
            print(f"VRT: {failure}", file=sys.stderr)
        return 1

    print(
        f"VRT: game content center={content_center:.1f}, bounds={content_extent:.1f}; "
        f"board center={board_center:.1f}, bounds={board_extent:.1f}; "
        f"HUD bounds={hud_extent:.1f} (expected {EXPECTED_CENTER:.0f})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
