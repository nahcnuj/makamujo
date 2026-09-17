import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { isPathInside, resolveInsideRoot } from "./paths";

describe("isPathInside", () => {
  const root = resolve("/tmp/makamujo-root");

  it("accepts the root itself and nested paths", () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(root, join(root, "a", "b"))).toBe(true);
  });

  it("rejects siblings and parent escapes", () => {
    expect(isPathInside(root, resolve(root, "..", "other"))).toBe(false);
    expect(isPathInside(root, join(root, "..", "escape"))).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isPathInside(root, `${root}/x\0y`)).toBe(false);
  });
});

describe("resolveInsideRoot", () => {
  const root = resolve("/tmp/makamujo-root");

  it("resolves relative segments under the root", () => {
    expect(resolveInsideRoot(root, "var/build")).toBe(
      join(root, "var", "build"),
    );
  });

  it("allows absolute paths that stay under the root", () => {
    expect(resolveInsideRoot(root, join(root, "tls", "cert.pem"))).toBe(
      join(root, "tls", "cert.pem"),
    );
  });

  it("rejects traversal and outside absolutes", () => {
    expect(resolveInsideRoot(root, "../outside")).toBeUndefined();
    expect(resolveInsideRoot(root, "/etc/passwd")).toBeUndefined();
    expect(resolveInsideRoot(root, "")).toBeUndefined();
  });
});
