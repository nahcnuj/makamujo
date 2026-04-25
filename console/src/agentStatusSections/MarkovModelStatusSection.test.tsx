import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

describe("MarkovModelStatusSection", () => {
  it("renders markov model section rows", () => {
    const html = renderToStaticMarkup(
      <MarkovModelStatusSection markovModelRows={[{ label: "生成N-gram", value: "4-gram" }]} />,
    );

    expect(html).toContain("マルコフ連鎖モデルの状態");
    expect(html).toContain("生成N-gram");
    expect(html).toContain("4-gram");
  });
});
