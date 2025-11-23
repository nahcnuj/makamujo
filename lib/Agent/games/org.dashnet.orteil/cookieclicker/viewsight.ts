import type { Data } from "./State";

export const viewsight = async (doc: Document) => {
  return {
    cookies: Number.parseFloat(doc.getElementById('cookies')?.innerText.replaceAll(',', '') ?? ''),
  } satisfies Partial<Data>;
};
