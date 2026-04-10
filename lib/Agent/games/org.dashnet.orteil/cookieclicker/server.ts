export type ElementLike = {
  readonly id: string;
  readonly parentElement: ElementLike | null;
  checkVisibility?(opts: { opacityProperty?: boolean; visibilityProperty?: boolean; contentVisibilityAuto?: boolean }): boolean;
};

/**
 * Collects the IDs of elements from `elements` that are eligible for click selection.
 * An element is eligible when it:
 *   - has a non-empty `id`,
 *   - does not have an `id` starting with `ariaReader-` (ARIA live regions, not interactive),
 *   - does not have the `id` `httpsSwitch`, `prefsButton`, or `bakeryName` (settings-related UI, not gameplay),
 *   - does not have the `id` `support` or `smallSupport`, and is not a descendant of either (ad/sponsor sections, not gameplay),
 *   - is a descendant of `boundary` (when `boundary` is non-null),
 *   - is visible (passes `checkVisibility`),
 *   - has `cursor: pointer` computed style,
 *   - does not have `pointer-events: none`, and
 *   - has no clickable ancestor with an `id` within `boundary` (to avoid selecting decorative children).
 */
export const collectClickableElementIds = (
  elements: Iterable<ElementLike>,
  boundary: ElementLike | null,
  getComputedStyle: (el: ElementLike) => Pick<CSSStyleDeclaration, 'cursor' | 'pointerEvents'>,
): string[] => {
  const ids: string[] = [];
  for (const el of elements) {
    if (!el.id) continue;
    if (el.id.startsWith('ariaReader-')) continue;
    if (el.id === 'httpsSwitch') continue;
    if (el.id === 'prefsButton') continue;
    if (el.id === 'bakeryName') continue;
    if (el.id === 'support') continue;
    if (el.id === 'smallSupport') continue;

    // Skip elements that are not within the boundary.
    if (boundary !== null) {
      let isWithinBoundary = false;
      let node: ElementLike | null = el.parentElement;
      while (node !== null) {
        if (node === boundary) {
          isWithinBoundary = true;
          break;
        }
        node = node.parentElement;
      }
      if (!isWithinBoundary) continue;
    }

    // Skip elements inside #support or #smallSupport (ad/sponsor sections, not gameplay).
    {
      let isInSupportSection = false;
      let node: ElementLike | null = el.parentElement;
      while (node !== null && node !== boundary) {
        if (node.id === 'support' || node.id === 'smallSupport') {
          isInSupportSection = true;
          break;
        }
        node = node.parentElement;
      }
      if (isInSupportSection) continue;
    }

    // checkVisibility is not available in some older browser builds; fall back to treating as visible.
    if (el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) === false) continue;
    const style = getComputedStyle(el);
    if (style.cursor !== 'pointer') continue;
    if (style.pointerEvents === 'none') continue;

    // Skip elements that merely inherit cursor:pointer from a clickable ancestor.
    // Such elements (e.g. gardenTileIcon inside gardenTile, productPrice inside product)
    // are decorative children of the true click target and would cause false positives.
    let hasClickableAncestorWithId = false;
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== boundary) {
      if (ancestor.id && getComputedStyle(ancestor).cursor === 'pointer') {
        hasClickableAncestorWithId = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (hasClickableAncestorWithId) continue;

    ids.push(el.id);
  }
  return ids;
};

export type SightRawData = {
  clickableElementIds: string[];
  cookiesText: string | undefined;
  cpsText: string | undefined;
  cpsIsWrinkled: boolean;
  ascendNumberText: string | undefined;
  commentsText: string | undefined;
  storeBulkModeSelectedId: string | undefined;
  statisticsGeneralListings: Array<{ key: string; innerText: string }> | undefined;
  url: string;
  title: string;
  selectedText: string;
  timestamp: number;
};

/**
 * Transforms raw sight data into the structured sight result.
 * This pure function is exported to enable unit testing of sight()'s
 * data-transformation logic without a browser environment.
 *
 * Note: sight() cannot call this function because sight() is serialized and
 * evaluated in the browser via page.evaluate(), which does not include
 * module-level definitions. sight() therefore implements the same
 * transformation inline.
 */
export const buildSightResult = (data: SightRawData) => {
  const parseNumber = (text?: string): number =>
    text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

  const parseBulkMode = (id: string | undefined): 'buy' | 'sell' | undefined => {
    const mode = id?.substring('storeBulk'.length).toLowerCase();
    return mode === 'buy' || mode === 'sell' ? mode : undefined;
  };

  const statistics = data.statisticsGeneralListings !== undefined
    ? {
        general: Object.fromEntries(
          data.statisticsGeneralListings.map(({ key, innerText }) => [key, { innerText }]),
        ),
      }
    : undefined;

  return {
    clickableElementIds: data.clickableElementIds,
    cookies: parseNumber(data.cookiesText),
    cps: parseNumber(data.cpsText?.replaceAll(/[^0-9.e+]/g, '')),
    isWrinkled: data.cpsIsWrinkled,
    ascendNumber: parseNumber(data.ascendNumberText),
    commentsText: data.commentsText,
    store: {
      products: {
        bulkMode: parseBulkMode(data.storeBulkModeSelectedId),
        items: [],
      },
      upgrades: [],
      tech: [],
      switches: [],
    },
    statistics,
    url: data.url,
    title: data.title,
    selectedText: data.selectedText,
    timestamp: data.timestamp,
  };
};

export const sight = () => {
  const parseNumber = (text?: string): number =>
    text ? Number.parseFloat(text.replaceAll(',', '')) : Number.NaN;

  const parseBulkMode = (id: string | undefined): 'buy' | 'sell' | undefined => {
    const mode = id?.substring('storeBulk'.length).toLowerCase();
    return mode === 'buy' || mode === 'sell' ? mode : undefined;
  };

  const cookiesPerSecond = document.getElementById('cookiesPerSecond');

  // Collects IDs of clickable elements only, because the Action API supports
  // clicking by element ID (clickByElementId) or by text (clickByText),
  // but not by arbitrary CSS selector.
  // NOTE: This logic is intentionally inlined rather than delegated to
  // collectClickableElementIds(), because sight() is serialized and evaluated
  // in the browser via page.evaluate(), which does not include module-level
  // function definitions.
  const clickableElementIds = (() => {
    const gameEl = document.getElementById('game');
    if (!gameEl) return [];
    const isVisible = (el: HTMLElement): boolean =>
      typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
        // checkVisibility is not available in some older browser builds; fall back to bounding-rect check.
        : el.getClientRects().length > 0;
    // When a modal popup is open, restrict click targets to elements within the popup only.
    // Elements outside an open popup are covered by the overlay and cannot actually be clicked.
    const promptEl = document.getElementById('prompt');
    const searchRoot = (promptEl !== null && isVisible(promptEl)) ? promptEl : gameEl;
    const ids: string[] = [];
    for (const el of searchRoot.querySelectorAll<HTMLElement>('[id]')) {
      if (!el.id) continue;
      if (el.id.startsWith('ariaReader-')) continue;
      if (el.id === 'httpsSwitch') continue;
      if (el.id === 'prefsButton') continue;
      if (el.id === 'bakeryName') continue;
      if (el.id === 'support') continue;
      if (el.id === 'smallSupport') continue;
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      if (style.cursor !== 'pointer') continue;
      if (style.pointerEvents === 'none') continue;
      // Skip elements inside #support or #smallSupport (ad/sponsor sections, not gameplay).
      {
        let isInSupportSection = false;
        let node = el.parentElement;
        while (node && node !== searchRoot) {
          if (node.id === 'support' || node.id === 'smallSupport') {
            isInSupportSection = true;
            break;
          }
          node = node.parentElement;
        }
        if (isInSupportSection) continue;
      }
      let hasClickableAncestorWithId = false;
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== searchRoot) {
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

  const menu = document.getElementById('menu');

  const statisticsGeneralListings = (() => {
    if (!menu) return undefined;
    const sections = Array.from(menu.getElementsByClassName('section'));
    const section = sections.find((el) => el.textContent?.includes('記録'));
    if (!section) return undefined;
    const subsections = Array.from(menu.getElementsByClassName('subsection'));
    const generalSection = subsections.find((el) => el.textContent?.includes('全般'));
    if (!generalSection) return undefined;
    const listings = Array.from(generalSection.getElementsByClassName('listing'));
    return listings.map((el) => {
      const key = Array.from(el.getElementsByTagName('b')).map((e) => e.innerText).join('').trim();
      const innerText = el.textContent?.substring(key.length) ?? '';
      return { key, innerText };
    });
  })();

  const statistics = statisticsGeneralListings !== undefined
    ? {
        general: Object.fromEntries(
          statisticsGeneralListings.map(({ key, innerText }) => [key, { innerText }]),
        ),
      }
    : undefined;

  return {
    clickableElementIds,
    cookies: parseNumber(document.getElementById('cookies')?.innerText.replaceAll(',', '')),
    cps: parseNumber(cookiesPerSecond?.innerText.replaceAll(/[^0-9.e+]/g, '')),
    isWrinkled: cookiesPerSecond?.classList.contains('wrinkled') ?? false,
    ascendNumber: parseNumber(document.getElementById('ascendNumber')?.innerText.replaceAll(',', '')),
    commentsText: document.getElementById('commentsText')?.innerText,
    store: {
      products: {
        bulkMode: parseBulkMode(
          Array.from(document.getElementsByClassName('storeBulkMode'))
            .filter(({ classList }) => classList.contains('selected'))
            .at(0)?.id,
        ),
        items: [],
      },
      upgrades: [],
      tech: [],
      switches: [],
    },
    statistics,
    url: location.href,
    title: document.title,
    selectedText: document.getSelection()?.toString() ?? '',
    timestamp: Date.now(),
  };
};

export { default as Component } from "./ReactComponent";
export { solver } from "./solver";
