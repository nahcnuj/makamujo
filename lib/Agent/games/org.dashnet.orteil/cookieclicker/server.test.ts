import { describe, expect, it } from "bun:test";
import { buildSightResult, collectClickableElementIds } from "./server";
import type { ElementLike, SightRawData } from "./server";

type StyleLike = Pick<CSSStyleDeclaration, 'cursor' | 'pointerEvents'>;

const makeElement = (
  id: string,
  {
    visible = true,
    parentElement = null,
  }: {
    visible?: boolean;
    parentElement?: ElementLike | null;
  } = {},
): ElementLike => ({
  id,
  parentElement,
  checkVisibility: () => visible,
});

const makeBoundary = (id: string = 'game'): ElementLike => ({
  id,
  parentElement: null,
  checkVisibility: () => true,
});

const makeGetComputedStyle = (styles: Map<ElementLike, StyleLike>) =>
  (el: ElementLike): StyleLike =>
    styles.get(el) ?? { cursor: 'default', pointerEvents: 'auto' };

describe('collectClickableElementIds', () => {
  it('returns an empty array when there are no elements', () => {
    const boundary = makeBoundary();
    const result = collectClickableElementIds([], boundary, makeGetComputedStyle(new Map()));
    expect(result).toEqual([]);
  });

  it('includes a visible element with cursor:pointer', () => {
    const boundary = makeBoundary();
    const el = makeElement('bigCookie');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual(['bigCookie']);
  });

  it('excludes an element that fails checkVisibility (invisible)', () => {
    const boundary = makeBoundary();
    const el = makeElement('hidden', { visible: false });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element with pointer-events:none', () => {
    const boundary = makeBoundary();
    const el = makeElement('noPE');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'none' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element without cursor:pointer', () => {
    const boundary = makeBoundary();
    const el = makeElement('noCursor');
    const styles = new Map([[el, { cursor: 'default', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes a child of a clickable ancestor (decorative child)', () => {
    const boundary = makeBoundary();
    const parent = makeElement('gardenTile', { parentElement: boundary });
    const child = makeElement('gardenTileIcon', { parentElement: parent });
    const styles = new Map([
      [parent, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
      [child, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    const result = collectClickableElementIds([parent, child], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual(['gardenTile']);
  });

  it('passes correct options to checkVisibility', () => {
    const receivedOpts: unknown[] = [];
    const boundary = makeBoundary();
    const el: ElementLike = {
      id: 'el',
      parentElement: null,
      checkVisibility: (opts) => { receivedOpts.push(opts); return true; },
    };
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(receivedOpts).toEqual([{ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }]);
  });
});

const baseSightRawData: SightRawData = {
  clickableElementIds: [],
  cookiesText: undefined,
  cpsText: undefined,
  cpsIsWrinkled: false,
  ascendNumberText: undefined,
  commentsText: undefined,
  storeBulkModeSelectedId: undefined,
  statisticsGeneralListings: undefined,
  url: 'https://example.com',
  title: 'Test',
  selectedText: '',
  timestamp: 0,
};

describe('buildSightResult', () => {
  it('passes through clickableElementIds, url, title, selectedText, timestamp', () => {
    const result = buildSightResult({
      ...baseSightRawData,
      clickableElementIds: ['bigCookie', 'product0'],
      url: 'https://orteil.dashnet.org/cookieclicker/',
      title: 'Cookie Clicker',
      selectedText: 'some text',
      timestamp: 12345,
    });
    expect(result.clickableElementIds).toEqual(['bigCookie', 'product0']);
    expect(result.url).toBe('https://orteil.dashnet.org/cookieclicker/');
    expect(result.title).toBe('Cookie Clicker');
    expect(result.selectedText).toBe('some text');
    expect(result.timestamp).toBe(12345);
  });

  it('parses cookies from comma-separated text', () => {
    const result = buildSightResult({ ...baseSightRawData, cookiesText: '1,234,567' });
    expect(result.cookies).toBe(1234567);
  });

  it('returns NaN for cookies when text is undefined', () => {
    const result = buildSightResult({ ...baseSightRawData, cookiesText: undefined });
    expect(result.cookies).toBeNaN();
  });

  it('parses cps stripping commas and non-numeric characters', () => {
    const result = buildSightResult({ ...baseSightRawData, cpsText: '1,234.5 /s' });
    expect(result.cps).toBe(1234.5);
  });

  it('parses cps in scientific notation', () => {
    const result = buildSightResult({ ...baseSightRawData, cpsText: '1.5e+3' });
    expect(result.cps).toBe(1500);
  });

  it('reflects isWrinkled from cpsIsWrinkled', () => {
    expect(buildSightResult({ ...baseSightRawData, cpsIsWrinkled: false }).isWrinkled).toBe(false);
    expect(buildSightResult({ ...baseSightRawData, cpsIsWrinkled: true }).isWrinkled).toBe(true);
  });

  it('parses ascendNumber from text', () => {
    const result = buildSightResult({ ...baseSightRawData, ascendNumberText: '42' });
    expect(result.ascendNumber).toBe(42);
  });

  it('sets bulkMode to buy when storeBulkBuy is selected', () => {
    const result = buildSightResult({ ...baseSightRawData, storeBulkModeSelectedId: 'storeBulkBuy' });
    expect(result.store.products.bulkMode).toBe('buy');
  });

  it('sets bulkMode to sell when storeBulkSell is selected', () => {
    const result = buildSightResult({ ...baseSightRawData, storeBulkModeSelectedId: 'storeBulkSell' });
    expect(result.store.products.bulkMode).toBe('sell');
  });

  it('sets bulkMode to undefined when no bulk mode element is selected', () => {
    const result = buildSightResult({ ...baseSightRawData, storeBulkModeSelectedId: undefined });
    expect(result.store.products.bulkMode).toBeUndefined();
  });

  it('builds statistics.general from listings', () => {
    const result = buildSightResult({
      ...baseSightRawData,
      statisticsGeneralListings: [
        { key: 'Cookies baked (all time)', innerText: ' 1,234,567' },
        { key: 'Cookie clicks', innerText: ' 42' },
      ],
    });
    expect(result.statistics).toEqual({
      general: {
        'Cookies baked (all time)': { innerText: ' 1,234,567' },
        'Cookie clicks': { innerText: ' 42' },
      },
    });
  });

  it('sets statistics to undefined when no listings are provided', () => {
    const result = buildSightResult({ ...baseSightRawData, statisticsGeneralListings: undefined });
    expect(result.statistics).toBeUndefined();
  });
});
