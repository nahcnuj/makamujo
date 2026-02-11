import { describe, expect, it } from "bun:test";
import distribution from "../routes/api/distribution";

describe("/api/distribution (unit)", () => {
  it("returns the current distribution from talkModel.toJSON()", async () => {
    const modelObj = { model: { "": { "。": 1 }, "こんにちは": { "世界": 2 } } };
    const dummyModel = {
      toJSON: () => JSON.stringify(modelObj),
    } as any;

    const streamer = {
      talkModel: dummyModel,
    } as any;

    const handler = distribution(streamer).GET;
    const res = await handler({} as any, {} as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(modelObj.model);
  });

  it("returns 500 when talkModel.toJSON() throws", async () => {
    const dummyModel = {
      toJSON: () => { throw new Error("boom"); },
    } as any;

    const streamer = {
      talkModel: dummyModel,
    } as any;

    const handler = distribution(streamer).GET;
    const res = await handler({} as any, {} as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({});
  });
});
