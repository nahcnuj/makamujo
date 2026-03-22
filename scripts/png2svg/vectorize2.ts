import fs from "fs";
import path from "path";
import zlib from "zlib";

function toHex(r: number, g: number, b: number) {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1)
    .toUpperCase()}`;
}

function quantizeColor(r: number, g: number, b: number, levels = 12): [number, number, number] {
  const step = 256 / levels;
  const qr = Math.floor(r / step) * step;
  const qg = Math.floor(g / step) * step;
  const qb = Math.floor(b / step) * step;
  return [Math.min(255, Math.round(qr)), Math.min(255, Math.round(qg)), Math.min(255, Math.round(qb))];
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buffer: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!buffer.slice(0, 8).equals(signature)) {
    throw new Error("Not a PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let compressionMethod = 0;
  let filterMethod = 0;
  let interlaceMethod = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.slice(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data.readUInt8(9);
      compressionMethod = data.readUInt8(10);
      filterMethod = data.readUInt8(11);
      interlaceMethod = data.readUInt8(12);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (interlaceMethod !== 0) {
    throw new Error("Interlaced PNG not supported");
  }
  if (compressionMethod !== 0 || filterMethod !== 0) {
    throw new Error("Unsupported PNG compression/filter method");
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));

  let bpp = 0;
  if (colorType === 6) bpp = 4;
  else if (colorType === 2) bpp = 3;
  else if (colorType === 0) bpp = 1;
  else throw new Error(`Unsupported color type: ${colorType}`);

  const rowBytes = width * bpp;
  const pixels = new Uint8Array(width * height * 4);
  let ro = 0;
  let prevRow: Uint8Array | null = null;

  for (let y = 0; y < height; y++) {
    const filter = raw[ro];
    const row = raw.slice(ro + 1, ro + 1 + rowBytes);
    ro += 1 + rowBytes;
    const recon = new Uint8Array(rowBytes);

    if (filter === 0) {
      recon.set(row);
    } else if (filter === 1) {
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? (recon[i - bpp] ?? 0) : 0;
        const r = row[i] ?? 0;
        recon[i] = (r + left) & 0xff;
      }
    } else if (filter === 2) {
      for (let i = 0; i < rowBytes; i++) {
        const up = prevRow ? (prevRow[i] ?? 0) : 0;
        const r = row[i] ?? 0;
        recon[i] = (r + up) & 0xff;
      }
    } else if (filter === 3) {
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? (recon[i - bpp] ?? 0) : 0;
        const up = prevRow ? (prevRow[i] ?? 0) : 0;
        const r = row[i] ?? 0;
        recon[i] = (r + Math.floor((left + up) / 2)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? (recon[i - bpp] ?? 0) : 0;
        const up = prevRow ? (prevRow[i] ?? 0) : 0;
        const upLeft = i >= bpp && prevRow ? (prevRow[i - bpp] ?? 0) : 0;
        const r = row[i] ?? 0;
        recon[i] = (r + paethPredictor(left, up, upLeft)) & 0xff;
      }
    } else {
      throw new Error(`Unsupported filter type: ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      if (colorType === 6) {
        pixels[dst] = recon[src] ?? 0;
        pixels[dst + 1] = recon[src + 1] ?? 0;
        pixels[dst + 2] = recon[src + 2] ?? 0;
        pixels[dst + 3] = recon[src + 3] ?? 255;
      } else if (colorType === 2) {
        pixels[dst] = recon[src] ?? 0;
        pixels[dst + 1] = recon[src + 1] ?? 0;
        pixels[dst + 2] = recon[src + 2] ?? 0;
        pixels[dst + 3] = 255;
      } else {
        const v = recon[src] ?? 0;
        pixels[dst] = v;
        pixels[dst + 1] = v;
        pixels[dst + 2] = v;
        pixels[dst + 3] = 255;
      }
    }
    prevRow = recon;
  }

  return { width, height, pixels };
}

async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: bun run scripts/png2svg/vectorize2.ts <input.png> <output.svg>");
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const resolvedOutput = path.resolve(process.cwd(), outputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(2);
  }

  const imageBuffer = fs.readFileSync(resolvedInput);
  const image = decodePng(imageBuffer);
  const width = image.width;
  const height = image.height;
  const pixels = image.pixels;

  const block = 8;
  const parts: string[] = [];
  const palette = new Set<string>();

  for (let y = 0; y < height; y += block) {
    const hblock = Math.min(block, height - y);
    for (let x = 0; x < width; x += block) {
      const wblock = Math.min(block, width - x);
      let rsum = 0;
      let gsum = 0;
      let bsum = 0;
      let asum = 0;
      let count = 0;

      for (let yy = 0; yy < hblock; yy++) {
        for (let xx = 0; xx < wblock; xx++) {
          const idx = ((y + yy) * width + (x + xx)) * 4;
          const a = pixels[idx + 3] ?? 0;
          if (a < 8) continue;
          rsum += pixels[idx] ?? 0;
          gsum += pixels[idx + 1] ?? 0;
          bsum += pixels[idx + 2] ?? 0;
          asum += a;
          count++;
        }
      }

      if (count === 0) continue;
      const r = Math.round(rsum / count);
      const g = Math.round(gsum / count);
      const b = Math.round(bsum / count);
      const a = Math.round((asum / count) / 2.55) / 100;
      const [qr, qg, qb] = quantizeColor(r, g, b, 12);
      const fill = toHex(qr, qg, qb);
      const opacity = a < 1 ? a.toFixed(2) : undefined;
      palette.add(fill);

      parts.push(`  <rect x="${x}" y="${y}" width="${wblock}" height="${hblock}" fill="${fill}"${opacity ? ` fill-opacity="${opacity}"` : ""} />`);
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">\n` +
    `<title>Vectorized from ${path.basename(resolvedInput)}</title>\n` +
    `<desc>Block quantization vectorization (no embedded raster).</desc>\n` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />\n` +
    `${parts.join("\n")}\n` +
    `</svg>`;

  fs.writeFileSync(resolvedOutput, svg, "utf8");

  console.log(`Generated vector SVG: ${resolvedOutput}`);
  console.log(`Original bytes: ${imageBuffer.length}, output bytes: ${Buffer.byteLength(svg, "utf8")}`);
  console.log(`Dimensions ${width}x${height}, palette=${palette.size}`);
}

main().catch((err) => { console.error(err); process.exit(99); });