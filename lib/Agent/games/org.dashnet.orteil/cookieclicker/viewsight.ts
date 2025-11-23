import type { State } from "./State";

const parseNumber = (text?: string): number => text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

export const viewsight = async (doc: Document) => {
  const cookiesPerSecond = doc.getElementById('cookiesPerSecond');
  return {
    cookies: parseNumber(doc.getElementById('cookies')?.innerText.replaceAll(',', '')),
    cps: parseNumber(cookiesPerSecond?.innerText.replaceAll(',', '')),
    isWrinkled: cookiesPerSecond?.classList.contains('wrinkled') ?? false,
    ascendNumber: parseNumber(doc.getElementById('ascendNumber')?.innerText.replaceAll(',', '')),
    commentsText: doc.getElementById('commentsText')?.innerText,
    store: {
      products: {
        bulkMode: Array.from(doc.getElementsByClassName('storeBulkMode')).filter(({ classList }) => classList.contains('selected')).at(0)?.id.substring('storeBulk'.length).toLowerCase() as 'buy' | 'sell',
        items: [], // TODO
      },
      upgrades: [], // TODO
      tech: [], // TODO
      switches: [], // TODO
    },
  } satisfies State;
};
