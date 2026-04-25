import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";

describe("LiveDeliveryStatusSection", () => {
    it("renders live delivery rows", () => {
        const html = renderToStaticMarkup(
            <LiveDeliveryStatusSection
                liveDeliveryRows={[
                    { label: "配信指標", valueComponent: <div>metrics</div> },
                    { label: "配信URL", value: "https://example.com/live", href: "https://example.com/live" },
                ]}
            />,
        );

        expect(html).toContain("配信状況");
        expect(html).toContain("metrics");
        expect(html).toContain("href=\"https://example.com/live\"");
    });
});
