import type { State } from "./State";

export const viewsight = async () => {
  const parseNumber = (text?: string): number => text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

  const cookiesPerSecond = document.getElementById('cookiesPerSecond');
  return {
    cookies: parseNumber(document.getElementById('cookies')?.innerText.replaceAll(',', '')),
    cps: parseNumber(cookiesPerSecond?.innerText.replaceAll(/[^0-9.e+]/g, '')),
    isWrinkled: cookiesPerSecond?.classList.contains('wrinkled') ?? false,
    ascendNumber: parseNumber(document.getElementById('ascendNumber')?.innerText.replaceAll(',', '')),
    commentsText: document.getElementById('commentsText')?.innerText,
    store: {
      products: {
        bulkMode: Array.from(document.getElementsByClassName('storeBulkMode')).filter(({ classList }) => classList.contains('selected')).at(0)?.id.substring('storeBulk'.length).toLowerCase() as 'buy' | 'sell',
        items: [], // TODO
      },
      upgrades: [], // TODO
      tech: [], // TODO
      switches: [], // TODO
    },
  } satisfies State;
};
