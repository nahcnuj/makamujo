import type { Page } from "playwright";
import type { Data } from "./State";

export const viewsight = async (page: Page) => {
  const [
    cookies,
  ] = await Promise.all([
    page.locator('#cookies').innerText().then(s => s.replaceAll(',', '')).then(Number.parseFloat),
  ]);
  return {
    cookies,
  } satisfies Partial<Data>;
};
