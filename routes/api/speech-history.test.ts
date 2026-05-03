import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GET, setSpeechHistoryRef } from "./speech-history";

const SAMPLE_HISTORY = [
  { id: "speech-5", speech: "five", nGram: 4 },
  { id: "speech-4", speech: "four", nGram: 3 },
  { id: "speech-3", speech: "three", nGram: 4 },
  { id: "speech-2", speech: "two", nGram: 2 },
  { id: "speech-1", speech: "one", nGram: 4 },
];

beforeEach(() => {
  setSpeechHistoryRef([...SAMPLE_HISTORY]);
});

afterEach(() => {
  setSpeechHistoryRef([]);
});

describe("GET /api/speech-history", () => {
  it("returns all items when no before param given and limit covers all", async () => {
    const req = new Request("http://localhost/api/speech-history?limit=10");
    const res = GET(req);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.items).toHaveLength(5);
    expect(data.hasMore).toBe(false);
  });

  it("returns items before the given id", async () => {
    const req = new Request("http://localhost/api/speech-history?before=speech-3&limit=10");
    const res = GET(req);
    const data = await res.json();
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(["speech-2", "speech-1"]);
    expect(data.hasMore).toBe(false);
  });

  it("respects the limit parameter", async () => {
    const req = new Request("http://localhost/api/speech-history?limit=2");
    const res = GET(req);
    const data = await res.json();
    expect(data.items).toHaveLength(2);
    expect(data.hasMore).toBe(true);
    expect(data.items[0].id).toBe("speech-5");
  });

  it("returns empty items and hasMore false when before id is not found", async () => {
    const req = new Request("http://localhost/api/speech-history?before=speech-999");
    const res = GET(req);
    const data = await res.json();
    expect(data.items).toHaveLength(0);
    expect(data.hasMore).toBe(false);
  });

  it("caps limit at 50", async () => {
    const largeHistory = Array.from({ length: 60 }, (_, i) => ({
      id: `speech-${60 - i}`,
      speech: `speech ${60 - i}`,
      nGram: 4,
    }));
    setSpeechHistoryRef(largeHistory);

    const req = new Request("http://localhost/api/speech-history?limit=100");
    const res = GET(req);
    const data = await res.json();
    expect(data.items).toHaveLength(50);
    expect(data.hasMore).toBe(true);
  });

  it("reflects live mutations to the bound array reference", async () => {
    const liveArray: typeof SAMPLE_HISTORY = [];
    setSpeechHistoryRef(liveArray);

    const req1 = new Request("http://localhost/api/speech-history");
    const data1 = await GET(req1).json();
    expect(data1.items).toHaveLength(0);

    liveArray.unshift({ id: "speech-new", speech: "new", nGram: 4 });

    const req2 = new Request("http://localhost/api/speech-history");
    const data2 = await GET(req2).json();
    expect(data2.items).toHaveLength(1);
    expect(data2.items[0].id).toBe("speech-new");
  });
});
