import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

describe("MarkovModelStatusSection", () => {
    it("renders markov model rows", () => {
        const html = renderToStaticMarkup(
            <MarkovModelStatusSection markovModelRows={[{ label: "生成N-gram", value: "3-gram (0.42)" }]} />,
        );

        expect(html).toContain("マルコフ連鎖モデルの状態");
        expect(html).toContain("生成N-gram");
        expect(html).toContain("3-gram");
    });
});
