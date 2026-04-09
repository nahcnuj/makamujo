export const sight = () => {
  const parseNumber = (text?: string): number =>
    text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

  const cookiesPerSecond = document.getElementById('cookiesPerSecond');

  // Collects IDs of clickable elements only, because the Action API supports
  // clicking by element ID (clickByElementId) or by text (clickByText),
  // but not by arbitrary CSS selector.
  const clickableElementIds = (() => {
    const gameEl = document.getElementById('game');
    if (!gameEl) return [];
    const ids: string[] = [];
    for (const el of gameEl.querySelectorAll<HTMLElement>('[id]')) {
      if (!el.id) continue;
      if (window.getComputedStyle(el).cursor !== 'pointer') continue;
      if (window.getComputedStyle(el).pointerEvents === 'none') continue;

      // Skip elements that merely inherit cursor:pointer from a clickable ancestor.
      // Such elements (e.g. gardenTileIcon inside gardenTile, productPrice inside product)
      // are decorative children of the true click target and would cause false positives.
      let hasClickableAncestorWithId = false;
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== gameEl) {
        if (ancestor.id && window.getComputedStyle(ancestor).cursor === 'pointer') {
          hasClickableAncestorWithId = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (hasClickableAncestorWithId) continue;

      ids.push(el.id);
    }
    return ids;
  })();

  const common = {
    clickableElementIds,
    cookies: parseNumber(document.getElementById('cookies')?.innerText.replaceAll(',', '')),
    cps: parseNumber(cookiesPerSecond?.innerText.replaceAll(/[^0-9.e+]/g, '')),
    isWrinkled: cookiesPerSecond?.classList.contains('wrinkled') ?? false,
    ascendNumber: parseNumber(document.getElementById('ascendNumber')?.innerText.replaceAll(',', '')),
    commentsText: document.getElementById('commentsText')?.innerText,
    store: {
      products: {
        bulkMode: Array.from(document.getElementsByClassName('storeBulkMode')).filter(({ classList }) =>
          classList.contains('selected'),
        ).at(0)?.id.substring('storeBulk'.length).toLowerCase() as 'buy' | 'sell',
        items: [],
      },
      upgrades: [],
      tech: [],
      switches: [],
    },
  };

  const menu = document.getElementById('menu');
  if (!menu) {
    return {
      ...common,
      url: location.href,
      title: document.title,
      selectedText: document.getSelection()?.toString() ?? '',
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
    url: location.href,
    title: document.title,
    selectedText: document.getSelection()?.toString() ?? '',
    timestamp: Date.now(),
  };
};

export { default as Component } from "./ReactComponent";
export { solver } from "./solver";
