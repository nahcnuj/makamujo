import { describe, expect, it } from "bun:test";
import {
  isRecord,
  readNestedString,
  readNumberField,
  readStringArrayField,
  readStringField,
} from "./json";

describe("isRecord", () => {
  it("accepts objects and arrays", () => {
    expect(isRecord({})).toBeTrue();
    expect(isRecord([])).toBeTrue();
  });

  it("rejects null, primitives and functions", () => {
    expect(isRecord(null)).toBeFalse();
    expect(isRecord(undefined)).toBeFalse();
    expect(isRecord(0)).toBeFalse();
    expect(isRecord("x")).toBeFalse();
    expect(isRecord(() => {})).toBeFalse();
  });
});

describe("readNumberField", () => {
  it("returns the field when it is a number", () => {
    expect(readNumberField({ no: 42 }, "no")).toBe(42);
    expect(readNumberField({ no: 0 }, "no")).toBe(0);
    expect(readNumberField({ no: -1 }, "no")).toBe(-1);
  });

  it("returns undefined for a missing or non-numeric field", () => {
    expect(readNumberField({}, "no")).toBeUndefined();
    expect(readNumberField({ no: "42" }, "no")).toBeUndefined();
    expect(readNumberField({ no: null }, "no")).toBeUndefined();
  });

  it("returns undefined when the value is not a record", () => {
    expect(readNumberField(null, "no")).toBeUndefined();
    expect(readNumberField("x", "no")).toBeUndefined();
  });

  it("tolerates a prototype-less object", () => {
    expect(readNumberField(Object.create(null), "no")).toBeUndefined();
  });
});

describe("readStringField", () => {
  it("returns the field when it is a string", () => {
    expect(readStringField({ text: "hi" }, "text")).toBe("hi");
    expect(readStringField({ text: "" }, "text")).toBe("");
  });

  it("returns undefined for a missing or non-string field", () => {
    expect(readStringField({}, "text")).toBeUndefined();
    expect(readStringField({ text: 1 }, "text")).toBeUndefined();
    expect(readStringField({ text: null }, "text")).toBeUndefined();
  });

  it("returns undefined when the value is not a record", () => {
    expect(readStringField(null, "text")).toBeUndefined();
  });
});

describe("readStringArrayField", () => {
  it("returns the field when it is an array of strings", () => {
    expect(readStringArrayField({ nodes: ["a", "b"] }, "nodes")).toEqual([
      "a",
      "b",
    ]);
    expect(readStringArrayField({ nodes: [] }, "nodes")).toEqual([]);
  });

  it("drops entries that are not strings", () => {
    expect(
      readStringArrayField({ nodes: ["a", 1, null, "b"] }, "nodes"),
    ).toEqual(["a", "b"]);
  });

  it("returns undefined for a missing or non-array field", () => {
    expect(readStringArrayField({}, "nodes")).toBeUndefined();
    expect(readStringArrayField({ nodes: "x" }, "nodes")).toBeUndefined();
    expect(
      readStringArrayField({ nodes: { length: 0 } }, "nodes"),
    ).toBeUndefined();
    expect(readStringArrayField(null, "nodes")).toBeUndefined();
  });
});

describe("readNestedString", () => {
  it("reads a nested string", () => {
    expect(
      readNestedString(
        { origin: { message: { gift: { advertiserName: "sponsor" } } } },
        ["origin", "message", "gift", "advertiserName"],
      ),
    ).toBe("sponsor");
  });

  it("returns undefined when a link in the chain is missing", () => {
    expect(readNestedString({}, ["origin", "message"])).toBeUndefined();
    expect(readNestedString(undefined, ["origin"])).toBeUndefined();
  });

  it("returns undefined when a link is a primitive", () => {
    expect(readNestedString({ origin: "text" }, ["origin", "message"])).toBe(
      undefined,
    );
  });

  it("returns undefined when the leaf is not a string", () => {
    expect(
      readNestedString({ origin: { n: 1 } }, ["origin", "n"]),
    ).toBeUndefined();
    expect(
      readNestedString({ origin: { n: null } }, ["origin", "n"]),
    ).toBeUndefined();
  });

  it("returns the value itself when the key path is empty", () => {
    expect(readNestedString("plain", [])).toBe("plain");
    expect(readNestedString(5, [])).toBeUndefined();
  });
});
