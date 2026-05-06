import { compile } from "tailwindcss";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const TAILWIND_CSS_PATH = resolve(process.cwd(), "node_modules/tailwindcss/index.css");
const compiledCssCache = new Map<string, Promise<string>>();
const candidateExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css"]);
const excludedDirectories = new Set(["node_modules", ".git", "dist", "build"]);

function tokenizeCandidates(source: string): Set<string> {
  const candidates = new Set<string>();
  const tokenRegex = /[A-Za-z][A-Za-z0-9_\-:\/\[\]]{0,99}/g;
  for (const token of source.match(tokenRegex) ?? []) {
    if (token.includes("class=") || token.includes("className=")) continue;
    candidates.add(token);
  }
  return candidates;
}

function extractCandidatesFromContent(content: string, extension: string): Set<string> {
  const candidates = new Set<string>();
  const classAttributeRegex = /(?:class|className)\s*=\s*(?:\{\s*)?(?:`([^`]+)`|(['"])(.*?)\2)\s*(?:\})?/gs;
  for (const match of content.matchAll(classAttributeRegex)) {
    const raw = match[1] ?? match[3] ?? "";
    for (const candidate of raw.trim().split(/\s+/)) {
      if (candidate) candidates.add(candidate);
    }
  }

  if (extension === ".css") {
    const applyRegex = /@apply\s+([^;]+);/g;
    for (const match of content.matchAll(applyRegex)) {
      for (const candidate of match[1].trim().split(/\s+/)) {
        if (candidate) candidates.add(candidate);
      }
    }
  }

  for (const token of tokenizeCandidates(content)) {
    candidates.add(token);
  }

  return candidates;
}

function walkFiles(directory: string, candidates: Set<string>) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, candidates);
      continue;
    }
    const extension = extname(entry.name);
    if (!candidateExtensions.has(extension)) continue;
    const content = readFileSync(fullPath, "utf-8");
    for (const candidate of extractCandidatesFromContent(content, extension)) {
      candidates.add(candidate);
    }
  }
}

function gatherCandidatesForSource(sourcePath: string): string[] {
  const rootDirectory = sourcePath.startsWith("console/") ? resolve(process.cwd(), "console/src") : resolve(process.cwd(), "src");
  const candidates = new Set<string>();
  if (statSync(rootDirectory).isDirectory()) {
    walkFiles(rootDirectory, candidates);
  }
  return [...candidates];
}

async function loadStylesheet(id: string, base: string) {
  if (id === "tailwindcss" || id === "tailwindcss/index.css") {
    return {
      path: TAILWIND_CSS_PATH,
      base: dirname(TAILWIND_CSS_PATH),
      content: readFileSync(TAILWIND_CSS_PATH, "utf-8"),
    };
  }

  const resolvedPath = id.startsWith("/")
    ? resolve(process.cwd(), `.${id}`)
    : resolve(dirname(base), id);

  return {
    path: resolvedPath,
    base: dirname(resolvedPath),
    content: readFileSync(resolvedPath, "utf-8"),
  };
}

async function compileTailwindCssFromPath(sourcePath: string): Promise<string> {
  const absoluteSourcePath = resolve(process.cwd(), sourcePath);
  const source = readFileSync(absoluteSourcePath, "utf-8");
  const candidates = gatherCandidatesForSource(sourcePath);

  const result = await compile(source, {
    from: absoluteSourcePath,
    loadStylesheet,
  });

  return result.build(candidates);
}

function buildCssHeaders(css: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/css; charset=utf-8",
  };

  if (process.env.NODE_ENV === "production") {
    const etag = `"${createHash("sha256").update(css).digest("hex")}"`;
    headers["Cache-Control"] = "public, max-age=0, s-maxage=31536000, stale-while-revalidate=86400";
    headers["ETag"] = etag;
  } else {
    headers["Cache-Control"] = "no-cache";
  }

  return headers;
}

export function createCssResponse(css: string, req?: Request): Response {
  const headers = buildCssHeaders(css);
  if (process.env.NODE_ENV === "production" && req?.headers.get("if-none-match") === headers["ETag"]) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(css, { headers });
}

export async function compileTailwindCss(sourcePath: string): Promise<string> {
  const absoluteSourcePath = resolve(process.cwd(), sourcePath);
  if (process.env.NODE_ENV === "production") {
    let cached = compiledCssCache.get(absoluteSourcePath);
    if (!cached) {
      cached = compileTailwindCssFromPath(sourcePath).catch((err) => {
        compiledCssCache.delete(absoluteSourcePath);
        throw err;
      });
      compiledCssCache.set(absoluteSourcePath, cached);
    }
    return cached;
  }

  return compileTailwindCssFromPath(sourcePath);
}
