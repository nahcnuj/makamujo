import hashlib
from pathlib import Path
import struct
import sys
import zlib

# VRT baseline hash for the committed stream capture.
BASELINE_SHA256 = "6688285091a35311e55811243d50393df9b0ccc35e7ff44a55ea5457bb7c651d"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-stream-capture.py <path>")

    repo_root = Path(__file__).resolve().parents[2]
    path = (repo_root / sys.argv[1]).resolve()
    try:
        path.relative_to(repo_root)
    except ValueError as exc:
        raise SystemExit("path must be within repository root") from exc

    with path.open("rb") as stream:
        raw = stream.read()

    actual = hashlib.sha256(raw).hexdigest()
    assert actual == BASELINE_SHA256, (actual, BASELINE_SHA256)

    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "stream capture is not a PNG file"
    off = 8
    width = height = 0
    idat = b""
    while off < len(raw):
        (length,) = struct.unpack(">I", raw[off : off + 4])
        chunk_type = raw[off + 4 : off + 8]
        data = raw[off + 8 : off + 8 + length]
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(
                ">IIBB", data[:10]
            )
            assert (width, height) == (1280, 720), (width, height)
            assert bit_depth == 8 and color_type == 2, (bit_depth, color_type)
        elif chunk_type == b"IDAT":
            idat += data
        elif chunk_type == b"IEND":
            break
        off += 12 + length

    decoded = zlib.decompress(idat)
    bpp = 3
    stride = width * bpp
    prev = bytearray(stride)
    colors = set()
    pos = 0
    for _ in range(height):
        filt = decoded[pos]
        pos += 1
        row = bytearray(decoded[pos : pos + stride])
        pos += stride
        if filt == 1:
            for x in range(bpp, stride):
                row[x] = (row[x] + row[x - bpp]) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                up = prev[x]
                row[x] = (row[x] + ((left + up) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                up = prev[x]
                ul = prev[x - bpp] if x >= bpp else 0
                p = left + up - ul
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
                pred = (
                    left
                    if pa <= pb and pa <= pc
                    else (up if pb <= pc else ul)
                )
                row[x] = (row[x] + pred) & 255
        prev = row
        for x in range(0, stride, bpp):
            colors.add((row[x], row[x + 1], row[x + 2]))
    assert len(colors) > 1, "stream capture is blank"


if __name__ == "__main__":
    main()
