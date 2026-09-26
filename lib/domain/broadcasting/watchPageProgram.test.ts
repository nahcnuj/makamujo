import { describe, expect, it } from "bun:test";
import { decodeHtmlEntities, parseWatchPageProgram } from "./watchPageProgram";

const onAirProgram = {
  nicoliveProgramId: "lv351439452",
  title: "テスト配信",
  watchPageUrl: "https://live.nicovideo.jp/watch/lv351439452",
  beginTime: 1_700_000_000,
  status: "ON_AIR",
  statistics: {
    watchCount: 123,
    commentCount: 456,
    timeshiftReservationCount: null,
  },
};

const propsToPage = (props: unknown): string => {
  const json = JSON.stringify(props ?? null);
  return `<!DOCTYPE html><html><body><script id="embedded-data" data-props="${json
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")}"></script></body></html>`;
};

describe("decodeHtmlEntities", () => {
  it("unescapes the entities used by the embedded-data attribute", () => {
    expect(decodeHtmlEntities("&quot;a&amp;b&quot;&lt;c&gt;&#39;d&#39;")).toBe(
      `"a&b"<c>'d'`,
    );
  });

  it("keeps a bare ampersand untouched", () => {
    expect(decodeHtmlEntities("a&b")).toBe("a&b");
  });
});

describe("parseWatchPageProgram", () => {
  it("reads the program identity from the embedded data", () => {
    const parsed = parseWatchPageProgram(
      propsToPage({ program: onAirProgram }),
    );

    expect(parsed).toEqual({
      nicoliveProgramId: "lv351439452",
      title: "テスト配信",
      url: "https://live.nicovideo.jp/watch/lv351439452",
      isLive: true,
      startTime: 1_700_000_000,
    });
  });

  it("does not read viewer / comment counts (the page shows them only after JS runs)", () => {
    const parsed = parseWatchPageProgram(
      propsToPage({ program: onAirProgram }),
    );

    expect(parsed).not.toHaveProperty("listeners");
    expect(parsed).not.toHaveProperty("comments");
  });

  it("marks an ended program as not live", () => {
    const parsed = parseWatchPageProgram(
      propsToPage({ program: { ...onAirProgram, status: "ENDED" } }),
    );

    expect(parsed?.isLive).toBe(false);
  });

  it("falls back to the canonical watch URL when the page omits it", () => {
    const { watchPageUrl: _omitted, ...withoutUrl } = onAirProgram;
    const parsed = parseWatchPageProgram(propsToPage({ program: withoutUrl }));

    expect(parsed?.url).toBe("https://live.nicovideo.jp/watch/lv351439452");
  });

  it("defaults a missing title and start time", () => {
    const parsed = parseWatchPageProgram(
      propsToPage({
        program: { nicoliveProgramId: "lv1", status: "ON_AIR" },
      }),
    );

    expect(parsed?.title).toBe("");
    expect(parsed?.startTime).toBe(0);
  });

  it("ignores a non-numeric start time", () => {
    const parsed = parseWatchPageProgram(
      propsToPage({
        program: { ...onAirProgram, beginTime: "later" },
      }),
    );

    expect(parsed?.startTime).toBe(0);
  });

  it("returns undefined when the page has no embedded-data script", () => {
    expect(
      parseWatchPageProgram("<html><body>404</body></html>"),
    ).toBeUndefined();
  });

  it("returns undefined when embedded-data is not valid JSON", () => {
    expect(
      parseWatchPageProgram(
        '<script id="embedded-data" data-props="{not json}"></script>',
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the program block is missing or has no id", () => {
    expect(parseWatchPageProgram(propsToPage(undefined))).toBeUndefined();
    expect(
      parseWatchPageProgram(
        '<script id="embedded-data" data-props="{&quot;program&quot;:{}}"></script>',
      ),
    ).toBeUndefined();
  });
});
