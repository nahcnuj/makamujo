import { compile } from "tailwindcss";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TAILWIND_CSS_PATH = resolve(process.cwd(), "node_modules/tailwindcss/index.css");
const compiledCssCache = new Map<string, Promise<string>>();

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

  const result = await compile(source, {
    from: absoluteSourcePath,
    loadStylesheet,
  });

  return result.build([]);
}

export async function compileTailwindCss(sourcePath: string): Promise<string> {
  const absoluteSourcePath = resolve(process.cwd(), sourcePath);
  if (process.env.NODE_ENV === "production") {
    let cached = compiledCssCache.get(absoluteSourcePath);
    if (!cached) {
      cached = compileTailwindCssFromPath(sourcePath);
      compiledCssCache.set(absoluteSourcePath, cached);
    }
    return cached;
  }

  return compileTailwindCssFromPath(sourcePath);
}
