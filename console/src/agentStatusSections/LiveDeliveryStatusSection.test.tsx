import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";

describe("LiveDeliveryStatusSection", () => {
  it("renders live delivery section rows", () => {
    const html = renderToStaticMarkup(
      <LiveDeliveryStatusSection liveDeliveryRows={[{ label: "状態", value: "配信中" }]} />,
    );

    expect(html).toContain("配信状況");
    expect(html).toContain("状態");
    expect(html).toContain("配信中");
  });
});
