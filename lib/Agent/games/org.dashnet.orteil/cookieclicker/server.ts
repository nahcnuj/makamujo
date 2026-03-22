export const sight = (doc: Document) => {
  const parseNumber = (text?: string): number =>
    text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

  const cookiesPerSecond = doc.getElementById('cookiesPerSecond');

  const common = {
    cookies: parseNumber(doc.getElementById('cookies')?.innerText.replaceAll(',', '')),
    cps: parseNumber(cookiesPerSecond?.innerText.replaceAll(/[^0-9.e+]/g, '')),
    isWrinkled: cookiesPerSecond?.classList.contains('wrinkled') ?? false,
    ascendNumber: parseNumber(doc.getElementById('ascendNumber')?.innerText.replaceAll(',', '')),
    commentsText: doc.getElementById('commentsText')?.innerText,
    store: {
      products: {
        bulkMode: Array.from(doc.getElementsByClassName('storeBulkMode')).filter(({ classList }) =>
          classList.contains('selected'),
        ).at(0)?.id.substring('storeBulk'.length).toLowerCase() as 'buy' | 'sell',
        items: [],
      },
      upgrades: [],
      tech: [],
      switches: [],
    },
  };

  const menu = doc.getElementById('menu');
  if (!menu) {
    return {
      ...common,
      url: doc.location.href,
      title: doc.title,
      selectedText: doc.getSelection()?.toString() ?? '',
      timestamp: Date.now(),
    };
  }

  const sections = Array.from(menu.getElementsByClassName('section'));

  const statistics = (() => {
    const section = sections.find((el) => el.textContent?.includes('記録'));
    if (!section) return undefined;

    const subsections = Array.from(menu.getElementsByClassName('subsection'));

    const generalSection = subsections.find((el) => el.textContent?.includes('全般'));
    if (!generalSection) return undefined;

    const listings = Array.from(generalSection.getElementsByClassName('listing'));
    const general = Object.fromEntries(
      listings.map((el) => {
        const key = Array.from(el.getElementsByTagName('b')).map((e) => e.innerText).join('').trim();
        const innerText = el.textContent?.substring(key.length) ?? '';
        return [key, { innerText }];
      }),
    );

    return {
      general,
    };
  })();

  return {
    ...common,
    statistics,
    url: doc.location.href,
    title: doc.title,
    selectedText: doc.getSelection()?.toString() ?? '',
    timestamp: Date.now(),
  };
};

export { default as Component } from "./ReactComponent";
export { solver } from "./solver";
