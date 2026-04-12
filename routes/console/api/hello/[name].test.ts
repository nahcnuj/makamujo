import { describe, expect, it } from "bun:test";
import handleHelloName from "./[name]";

describe("GET /console/api/hello/:name", () => {
  it("returns Hello, {name}! for the given name", async () => {
    const req: Bun.BunRequest<"/console/api/hello/:name"> = Object.assign(
      new Request("http://localhost/console/api/hello/world"),
      {
        params: { name: "world" },
        cookies: new Bun.CookieMap(),
        clone(): Bun.BunRequest<"/console/api/hello/:name"> { return req; },
      },
    );
    const res = await handleHelloName(req);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ message: "Hello, world!" });
  });
});
