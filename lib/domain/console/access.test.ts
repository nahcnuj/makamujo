import { describe, expect, it } from "bun:test";
import {
  createAccessDeniedRedirectResponse,
  createLoopbackProxyHeaders,
  createUnauthorizedConsoleResponse,
  DEFAULT_CONSOLE_BASE_PATH,
  generateConsoleBasicAuthPassword,
  hasValidConsoleAuthorization,
  isConsoleIPRestrictionEnabled,
  parseBasicAuthCredentials,
  resolveConsoleBasicAuthPassword,
} from "./access";

describe("console access domain", () => {
  it("redirects denied /console/ paths to the watch page with 303", () => {
    const response = createAccessDeniedRedirectResponse(
      new URL("https://example.com/console/?q=1"),
      { consoleRedirectURL: "https://live.example/watch" },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://live.example/watch");
  });

  it("permanently redirects other paths to console base", () => {
    const response = createAccessDeniedRedirectResponse(
      new URL("https://example.com/other"),
      { consoleRedirectURL: "https://live.example/watch" },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(DEFAULT_CONSOLE_BASE_PATH);
  });

  it("enables IP restriction only in production", () => {
    expect(isConsoleIPRestrictionEnabled("production")).toBe(true);
    expect(isConsoleIPRestrictionEnabled("development")).toBe(false);
    expect(isConsoleIPRestrictionEnabled(undefined)).toBe(false);
  });

  it("strips hop-by-hop and identity headers for loopback proxy", () => {
    const original = new Headers([
      ["connection", "keep-alive, upgrade"],
      ["upgrade", "websocket"],
      ["host", "example.com"],
      ["origin", "https://example.com"],
      ["referer", "https://example.com/console/"],
      ["accept", "text/event-stream"],
      ["x-custom", "1"],
    ]);
    const headers = createLoopbackProxyHeaders(original);
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(headers.get("x-custom")).toBe("1");
    expect(headers.has("connection")).toBe(false);
    expect(headers.has("upgrade")).toBe(false);
    expect(headers.has("host")).toBe(false);
    expect(headers.has("origin")).toBe(false);
    expect(headers.has("referer")).toBe(false);
  });

  it("generates a 16-character alphanumeric Basic auth password", () => {
    const password = generateConsoleBasicAuthPassword();
    expect(password).toHaveLength(16);
    expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("uses CONSOLE_BASIC_AUTH_PASSWORD when provided", () => {
    const resolved = resolveConsoleBasicAuthPassword("fixed-secret");
    expect(resolved).toEqual({ password: "fixed-secret", generated: false });
  });

  it("generates a password when env is empty", () => {
    const resolved = resolveConsoleBasicAuthPassword(undefined);
    expect(resolved.generated).toBe(true);
    expect(resolved.password).toHaveLength(16);
  });

  it("parses and validates Basic auth credentials", () => {
    const header = `Basic ${btoa("admin:s3cret")}`;
    expect(parseBasicAuthCredentials(header)).toEqual({
      username: "admin",
      password: "s3cret",
    });
    expect(hasValidConsoleAuthorization(header, "s3cret")).toBe(true);
    expect(hasValidConsoleAuthorization(header, "wrong")).toBe(false);
    expect(hasValidConsoleAuthorization(null, "s3cret")).toBe(false);
  });

  it("builds a 401 challenge response", () => {
    const response = createUnauthorizedConsoleResponse();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });
});
