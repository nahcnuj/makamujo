import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GameStatusSection } from "./GameStatusSection";

describe("GameStatusSection", () => {
    it("renders game section rows", () => {
        const html = renderToStaticMarkup(
            <GameStatusSection gameRows={[{ label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" }]} />,
        );

        expect(html).toContain("ゲームの状態");
        expect(html).toContain("現在のゲーム");
        expect(html).toContain("org.dashnet.orteil/cookieclicker");
    });
});
