import { describe, expect, it } from "bun:test";
import { GET, PUT } from "./hello";

describe("GET /console/api/hello", () => {
  it("returns Hello, world! with method GET", async () => {
    const req = new Request("http://localhost/console/api/hello");
    const res = await GET(req);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ message: "Hello, world!", method: "GET" });
  });
});

describe("PUT /console/api/hello", () => {
  it("returns Hello, world! with method PUT", async () => {
    const req = new Request("http://localhost/console/api/hello", { method: "PUT" });
    const res = await PUT(req);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ message: "Hello, world!", method: "PUT" });
  });
});
