import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConsoleServer } from "../../../console/index";
import {
  createAccessDeniedRedirectResponse,
  createLoopbackProxyHeaders,
  createUnauthorizedConsoleResponse,
  DEFAULT_CONSOLE_BASE_PATH,
  hasValidConsoleAuthorization,
  isConsoleIPRestrictionEnabled,
} from "../../../lib/domain/console/access";

const consoleRedirectURL =
  process.env.CONSOLE_REDIRECT_URL ??
  "https://live.nicovideo.jp/watch/user/14171889";

test("throws when TLS certificate file is missing", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "console-test-"));
  try {
    expect(() =>
      startConsoleServer({
        certPath: join(tmpDir, "nonexistent-cert.pem"),
        keyPath: join(tmpDir, "nonexistent-key.pem"),
      }),
    ).toThrow("TLS certificate files not found");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("throws when TLS certificate file exists but key file is missing", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "console-test-"));
  const certFilePath = join(tmpDir, "cert.pem");
  writeFileSync(certFilePath, "placeholder");

  try {
    expect(() =>
      startConsoleServer({
        certPath: certFilePath,
        keyPath: join(tmpDir, "nonexistent-key.pem"),
      }),
    ).toThrow("TLS certificate files not found");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("returns 303 to watch page for denied /console/ access", () => {
  const response = createAccessDeniedRedirectResponse(
    new URL("https://example.com/console/?q=1"),
    {
      consoleRedirectURL,
    },
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(consoleRedirectURL);
});

test("returns 308 to /console/ for denied non-console access", () => {
  const response = createAccessDeniedRedirectResponse(
    new URL("https://example.com/other/path"),
    {
      consoleRedirectURL,
    },
  );
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(DEFAULT_CONSOLE_BASE_PATH);
});

test("strips hop-by-hop headers from loopback proxy requests", () => {
  const originalHeaders = new Headers([
    ["connection", "keep-alive"],
    ["upgrade", "websocket"],
    ["host", "x85-131-251-123.static.xvps.ne.jp"],
    ["origin", "https://x85-131-251-123.static.xvps.ne.jp"],
    ["referer", "https://x85-131-251-123.static.xvps.ne.jp/console/"],
    ["accept", "text/event-stream"],
  ]);

  const headers = createLoopbackProxyHeaders(originalHeaders);
  expect(headers.get("connection")).toBeNull();
  expect(headers.get("upgrade")).toBeNull();
  expect(headers.get("host")).toBeNull();
  expect(headers.get("origin")).toBeNull();
  expect(headers.get("referer")).toBeNull();
  expect(headers.get("accept")).toBe("text/event-stream");
});

test("strips proxy-authenticate and proxy-authorization from loopback proxy requests", () => {
  const originalHeaders = new Headers([
    ["proxy-authenticate", 'Basic realm="proxy"'],
    ["proxy-authorization", "Basic dXNlcjpwYXNz"],
    ["authorization", "Bearer token123"],
  ]);

  const headers = createLoopbackProxyHeaders(originalHeaders);
  expect(headers.get("proxy-authenticate")).toBeNull();
  expect(headers.get("proxy-authorization")).toBeNull();
  expect(headers.get("authorization")).toBe("Bearer token123");
});

test("strips headers named in Connection header value (RFC 7230)", () => {
  const originalHeaders = new Headers([
    ["connection", "x-custom-hop, another-hop"],
    ["x-custom-hop", "some-value"],
    ["another-hop", "other-value"],
    ["x-preserved", "preserved"],
  ]);

  const headers = createLoopbackProxyHeaders(originalHeaders);
  expect(headers.get("connection")).toBeNull();
  expect(headers.get("x-custom-hop")).toBeNull();
  expect(headers.get("another-hop")).toBeNull();
  expect(headers.get("x-preserved")).toBe("preserved");
});

test("disables console IP restriction in development mode", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = undefined;
    expect(isConsoleIPRestrictionEnabled()).toBe(false);

    process.env.NODE_ENV = "development";
    expect(isConsoleIPRestrictionEnabled()).toBe(false);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("enables console IP restriction in production mode", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    expect(isConsoleIPRestrictionEnabled()).toBe(true);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("production console Basic auth rejects missing credentials with 401", () => {
  expect(hasValidConsoleAuthorization(null, "expected-secret")).toBe(false);
  const unauthorized = createUnauthorizedConsoleResponse();
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("WWW-Authenticate")).toContain("Basic");
});

test("production console Basic auth accepts admin credentials", () => {
  const header = `Basic ${btoa("admin:expected-secret")}`;
  expect(hasValidConsoleAuthorization(header, "expected-secret")).toBe(true);
  expect(hasValidConsoleAuthorization(header, "other-secret")).toBe(false);
});
