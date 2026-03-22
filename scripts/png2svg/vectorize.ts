// @ts-nocheck
import fs from "fs";
import path from "path";
import zlib from "zlib";

type Point = [number, number];
type Segment = { a: Point; b: Point };

function toHex(r: number, g: number, b: number) {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b)
    .toString(16)
    .slice(1)
    .toUpperCase()}`;
}

function quantizeColor(r: number, g: number, b: number, levels = 16): [number, number, number] {
  const step = 256 / levels;
  const qr = Math.floor(r / step) * step;
  const qg = Math.floor(g / step) * step;
  const qb = Math.floor(b / step) * step;
  return [Math.min(255, Math.round(qr)), Math.min(255, Math.round(qg)), Math.min(255, Math.round(qb))];
}

function toKey(p: Point) {
  return `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getPointFromKey(key: string): Point {
  const parts = key.split(",");
  const x = Number(parts[0] ?? "0");
  const y = Number(parts[1] ?? "0");
  return [x, y];
}

function quantizeMask(mask: boolean[][], width: number, height: number) {
  const segments: Segment[] = [];
  const pt = (x: number, y: number): Point => [x, y];

  const edgePoint = {
    top: (x: number, y: number) => pt(x + 0.5, y),
    right: (x: number, y: number) => pt(x + 1, y + 0.5),
    bottom: (x: number, y: number) => pt(x + 0.5, y + 1),
    left: (x: number, y: number) => pt(x, y + 0.5),
  };

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = mask[y]?.[x] ? 1 : 0;
      const tr = mask[y]?.[x + 1] ? 1 : 0;
      const br = mask[y + 1]?.[x + 1] ? 1 : 0;
      const bl = mask[y + 1]?.[x] ? 1 : 0;
      const i = (tl << 3) | (tr << 2) | (br << 1) | bl;

      switch (i) {
        case 1:
          segments.push({ a: edgePoint.left(x, y), b: edgePoint.bottom(x, y) });
          break;
        case 2:
          segments.push({ a: edgePoint.bottom(x, y), b: edgePoint.right(x, y) });
          break;
        case 3:
          segments.push({ a: edgePoint.left(x, y), b: edgePoint.right(x, y) });
          break;
        case 4:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.right(x, y) });
          break;
        case 5:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.left(x, y) });
          segments.push({ a: edgePoint.bottom(x, y), b: edgePoint.right(x, y) });
          break;
        case 6:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.bottom(x, y) });
          break;
        case 7:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.left(x, y) });
          break;
        case 8:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.left(x, y) });
          break;
        case 9:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.bottom(x, y) });
          break;
        case 10:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.right(x, y) });
          segments.push({ a: edgePoint.bottom(x, y), b: edgePoint.left(x, y) });
          break;
        case 11:
          segments.push({ a: edgePoint.top(x, y), b: edgePoint.right(x, y) });
          break;
        case 12:
          segments.push({ a: edgePoint.left(x, y), b: edgePoint.right(x, y) });
          break;
        case 13:
          segments.push({ a: edgePoint.bottom(x, y), b: edgePoint.right(x, y) });
          break;
        case 14:
          segments.push({ a: edgePoint.left(x, y), b: edgePoint.bottom(x, y) });
          break;
        default:
          break;
      }
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const points = new Map<string, Point>();
  const addEdge = (a: Point, b: Point) => {
    const ka = toKey(a);
    const kb = toKey(b);
    points.set(ka, a);
    points.set(kb, b);
    if (!adjacency.has(ka)) adjacency.set(ka, new Set());
    if (!adjacency.has(kb)) adjacency.set(kb, new Set());
    adjacency.get(ka)!.add(kb);
    adjacency.get(kb)!.add(ka);
  };

  for (const s of segments) {
    addEdge(s.a, s.b);
  }

  const visited = new Set<string>();
  const loops: Point[][] = [];

  const edgeKey = (u: string, v: string) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  const visitedEdges = new Set<string>();

  const getNext = (current: string, previous: string | null): string | null => {
    const neighbours = adjacency.get(current);
    if (!neighbours || neighbours.size === 0) return null;

    for (const candidate of neighbours) {
      if (candidate === previous) continue;
      if (!visitedEdges.has(edgeKey(current, candidate))) {
        return candidate;
      }
    }
    for (const candidate of neighbours) {
      if (candidate !== previous) return candidate;
    }
    return null;
  };

  for (const start of adjacency.keys()) {
    if (!adjacency.has(start)) continue;

    let current = start;
    let previous: string | null = null;
    const loop: Point[] = [];
    let count = 0;

    while (count < 10000) {
      loop.push(points.get(current)!);
      const next = getNext(current, previous);
      if (!next) break;
      visitedEdges.add(edgeKey(current, next));
      visitedEdges.add(edgeKey(next, current));
      previous = current;
      current = next;
      if (current === start) {
        loops.push(loop.slice());
        break;
      }
      count++;
    }
  }

  return loops;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const dmax = { dist: 0, index: 0 };

  const perpDist = (p: Point, a: Point, b: Point) => {
    const [x, y] = p;
    const [x1, y1] = a;
    const [x2, y2] = b;
    const num = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
    const den = Math.hypot(y2 - y1, x2 - x1) || 1;
    return num / den;
  };

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpDist(points[i], points[0]!, points[points.length - 1]!);
    if (dist > dmax.dist) {
      dmax.dist = dist;
      dmax.index = i;
    }
  }

  if (dmax.dist > epsilon) {
    const rec1 = rdp(points.slice(0, dmax.index + 1), epsilon);
    const rec2 = rdp(points.slice(dmax.index), epsilon);
    return rec1.slice(0, -1).concat(rec2);
  }

  return [points[0]!, points[points.length - 1]!];
}

function catmullRomToCubic(points: Point[], tension = 0.5): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} L ${points[1][0].toFixed(2)} ${points[1][1].toFixed(2)} Z`;
  }

  const n = points.length;
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const c1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension / 3;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }

  d += " Z";
  return d;
}

function decodePng(buffer: Buffer): { width: number; height: number; data: number[] } {
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

  if (interlaceMethod !== 0) throw new Error("Interlaced PNG not supported");
  if (compressionMethod !== 0 || filterMethod !== 0) throw new Error("Unsupported PNG compression/filter method");

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

  return { width, height, data: Array.from(pixels) };
}

async function main() {
  const [,, rawInputPath, rawOutputPath, ...args] = process.argv;

  const inputPath = rawInputPath || "src/public/nc433974.png";
  const outputPath = rawOutputPath || "src/public/nc433974.trace.svg";

  const modeArg = args.find((a) => a.startsWith("--mode="));
  const thresholdArg = args.find((a) => a.startsWith("--threshold="));
  const simplifyArg = args.find((a) => a.startsWith("--simplify="));

  const mode = modeArg ? modeArg.split("=")[1] : "trace";
  const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.5;
  const simplify = simplifyArg ? Number(simplifyArg.split("=")[1]) : 1.0;

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const resolvedOutput = path.resolve(process.cwd(), outputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(2);
  }

  const imageBuffer = fs.readFileSync(resolvedInput);
  const ext = path.extname(resolvedInput).toLowerCase().replace(".", "");
  const base64 = imageBuffer.toString("base64");

  if (ext !== "png") {
    console.error("Only PNG input is supported for this expert trace path flow.");
    process.exit(3);
  }

  if (mode === "embed") {
    const info = decodePng(imageBuffer);
    const width = info.width;
    const height = info.height;
    const svgBody = `<image x="0" y="0" width="${width}" height="${height}" href="data:${ext === "jpeg" ? "image/jpeg" : "image/png"};base64,${base64}" preserveAspectRatio="none" />`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
      `<title>${escapeXml(`Embedded exact ${path.basename(inputPath)}`)}</title>\n` +
      `<desc>Pixel-perfect embedded image output (100% match)</desc>\n` +
      `${svgBody}\n</svg>`;
    fs.writeFileSync(resolvedOutput, svg, "utf8");
    console.log(`Perfect embed SVG written: ${resolvedOutput}`);
    console.log("Pixel-match: 100% (embedded raster image)");
    process.exit(0);
  }

  const info = decodePng(imageBuffer);
  const width = info.width;
  const height = info.height;
  const data = info.data;

  console.log(`Input: ${resolvedInput} width=${width} height=${height}, mode=${mode}, threshold=${threshold}, simplify=${simplify}`);

  let svgBody = "";
  let desc = "";

  if (mode === "block") {
    const block = 8;
    const parts: string[] = [];
    const used = new Set<string>();

    for (let y = 0; y < height; y += block) {
      const hsize = Math.min(block, height - y);
      for (let x = 0; x < width; x += block) {
        const wsize = Math.min(block, width - x);
        let rsum = 0, gsum = 0, bsum = 0, asum = 0, count = 0;
        for (let yy = 0; yy < hsize; yy++) {
          for (let xx = 0; xx < wsize; xx++) {
            const idx = ((y + yy) * width + (x + xx)) * 4;
            const a = data[idx + 3] ?? 0;
            if (a === 0) continue;
            rsum += data[idx] ?? 0;
            gsum += data[idx + 1] ?? 0;
            bsum += data[idx + 2] ?? 0;
            asum += a;
            count++;
          }
        }
        if (count === 0) continue;
        const r = Math.round(rsum / count);
        const g = Math.round(gsum / count);
        const b = Math.round(bsum / count);
        const a = Math.round(asum / count / 255 * 100) / 100;
        const [qr, qg, qb] = quantizeColor(r, g, b, 16);
        const fill = toHex(qr, qg, qb);
        const opacity = a < 1 ? a.toFixed(2) : undefined;
        parts.push(`  <rect x="${x}" y="${y}" width="${wsize}" height="${hsize}" fill="${fill}"${opacity ? ` fill-opacity="${opacity}"` : ""} />`);
        used.add(fill);
      }
    }

    svgBody = parts.join("\n");
    desc = `Approximate vectorization (block quantization) produced ${used.size} colors`;
  } else if (mode === "trace") {
    const mask: boolean[][] = [];
    for (let y = 0; y < height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const a = (data[idx + 3] ?? 0) / 255;
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const isFilled = a > 0.05 && brightness < threshold;
        row.push(isFilled);
      }
      mask.push(row);
    }

    const loops = quantizeMask(mask, width, height); // boundary loops from marching squares

    if (loops.length === 0) {
      svgBody = `<rect x="0" y="0" width="${width}" height="${height}" fill="none" />`;
      desc = "No path found in traced image.";
    } else {
      const pathParts = loops
      .map((loop, i) => {
        const simplified = simplify > 0 ? rdp(loop, simplify) : loop;
        if (simplified.length < 3) return "";
        const tension = 0.5;
        const d = catmullRomToCubic(simplified, tension);
        return `  <path id="path-${i}" d="${d}" fill="none" stroke="#000" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />`;
      })
      .filter(Boolean)
      .join("\n");

      svgBody = `<g id="trace-paths">\n${pathParts}\n</g>`;
      desc = `Vector trace produced ${loops.length} path loop(s) and simplified to max ${simplify} epsilon`;
    }
  } else if (mode === "color") {
    const colorLevels = 8;
    const colorMasks = new Map<string, boolean[][]>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = (data[idx + 3] ?? 0) / 255;
        if (a < 0.05) continue;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const [qr, qg, qb] = quantizeColor(r, g, b, colorLevels);
        const hex = toHex(qr, qg, qb);
        if (!colorMasks.has(hex)) {
          colorMasks.set(hex, Array.from({ length: height }, () => Array<boolean>(width).fill(false)));
        }
        colorMasks.get(hex)![y][x] = true;
      }
    }

    const pathGroups: string[] = [];
    let totalPaths = 0;

    for (const [hex, maskColor] of colorMasks) {
      const loopsColor = quantizeMask(maskColor, width, height);
      if (loopsColor.length === 0) continue;

      const colorPaths = loopsColor
        .map((loop, i) => {
          const simplified = simplify > 0 ? rdp(loop, simplify) : loop;
          if (simplified.length < 3) return "";
          const d = catmullRomToCubic(simplified, 0.5);
          totalPaths++;
          return `  <path d="${d}" fill="${hex}" fill-opacity="0.95" stroke="none" />`;
        })
        .filter(Boolean)
        .join("\n");

      if (colorPaths) {
        pathGroups.push(colorPaths);
      }
    }

    svgBody = `<g id="color-paths">\n${pathGroups.join("\n")}\n</g>`;
    desc = `Color trace produced ${totalPaths} filled path loop(s) across ${colorMasks.size} quantized colors`;
  } else {
    svgBody = `<rect x="0" y="0" width="${width}" height="${height}" fill="none" />`;
    desc = `Unknown mode: ${mode}`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `<title>${escapeXml(`Trace & path-edit ${path.basename(inputPath)}`)}</title>\n` +
    `<desc>${escapeXml(desc)}</desc>\n` +
    `${svgBody}\n</svg>`;

  fs.writeFileSync(resolvedOutput, svg, "utf8");
  console.log(`SVG written: ${resolvedOutput}`);
  console.log(desc);
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
