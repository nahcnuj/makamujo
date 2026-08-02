import { describe, expect, it } from "bun:test";
import {
  buildSightResult,
  collectClickableElementIds,
  enrichStatisticsGeneral,
  parseNewsLines,
} from "./server";
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
    const el = makeElement('bigCookie', { parentElement: boundary });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual(['bigCookie']);
  });

  it('excludes an element that fails checkVisibility (invisible)', () => {
    const boundary = makeBoundary();
    const el = makeElement('hidden', { visible: false, parentElement: boundary });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element with pointer-events:none', () => {
    const boundary = makeBoundary();
    const el = makeElement('noPE', { parentElement: boundary });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'none' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element without cursor:pointer', () => {
    const boundary = makeBoundary();
    const el = makeElement('noCursor', { parentElement: boundary });
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
      parentElement: boundary,
      checkVisibility: (opts) => { receivedOpts.push(opts); return true; },
    };
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(receivedOpts).toEqual([{ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }]);
  });

  it('excludes an element whose id starts with "ariaReader-"', () => {
    const boundary = makeBoundary();
    const el = makeElement('ariaReader-bigCookie');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes httpsSwitch', () => {
    const boundary = makeBoundary();
    const el = makeElement('httpsSwitch');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes prefsButton', () => {
    const boundary = makeBoundary();
    const el = makeElement('prefsButton');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes bakeryName', () => {
    const boundary = makeBoundary();
    const el = makeElement('bakeryName');
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes clickable descendants inside #support', () => {
    const boundary = makeBoundary();
    const support = makeElement('support', { parentElement: boundary });
    const child = makeElement('supportChild', { parentElement: support });
    const styles = new Map([
      [support, { cursor: 'default', pointerEvents: 'auto' }] as const,
      [child, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    const result = collectClickableElementIds([child], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes clickable descendants inside #smallSupport', () => {
    const boundary = makeBoundary();
    const smallSupport = makeElement('smallSupport', { parentElement: boundary });
    const child = makeElement('smallSupportChild', { parentElement: smallSupport });
    const styles = new Map([
      [smallSupport, { cursor: 'default', pointerEvents: 'auto' }] as const,
      [child, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    const result = collectClickableElementIds([child], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('includes an element when checkVisibility is not available (older browser fallback)', () => {
    const boundary = makeBoundary();
    const el: ElementLike = {
      id: 'el',
      parentElement: boundary,
    };
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const result = collectClickableElementIds([el], boundary, makeGetComputedStyle(styles));
    expect(result).toEqual(['el']);
  });

  // When a modal popup (#prompt) is open it is used as boundary instead of #game,
  // so only elements inside the popup are collected.
  it('includes only elements within the prompt boundary when a modal popup is open', () => {
    const promptBoundary = makeBoundary('prompt');
    const insidePrompt = makeElement('promptClose', { parentElement: promptBoundary });
    const outsidePrompt = makeElement('bigCookie', { parentElement: null });
    const styles = new Map([
      [insidePrompt, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
      [outsidePrompt, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    // Pass both inside/outside candidates; only the descendant of the prompt boundary should be kept.
    const result = collectClickableElementIds([insidePrompt, outsidePrompt], promptBoundary, makeGetComputedStyle(styles));
    expect(result).toEqual(['promptClose']);
  });

  it('excludes clickable elements outside prompt boundary', () => {
    const promptBoundary = makeBoundary('prompt');
    const outsidePrompt = makeElement('bigCookie', { parentElement: null });
    const styles = new Map([
      [outsidePrompt, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    const result = collectClickableElementIds([outsidePrompt], promptBoundary, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });
});

const baseSightRawData: SightRawData = {
  clickableElementIds: [],
  cookiesText: undefined,
  cpsText: undefined,
  cpsIsWrinkled: false,
  ascendNumberText: undefined,
  commentsText: undefined,
  commentsText1: undefined,
  commentsText2: undefined,
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

it('enriches Japanese statistics keys with parsed numbers', () => {
    const result = buildSightResult({
      ...baseSightRawData,
      statisticsGeneralListings: [
        { key: '遺産の始まり：', innerText: ' 362日前, 昇天 107回' },
        { key: 'クリック回数：', innerText: ' 1,009' },
        { key: '貯まったクッキー：', innerText: ' 9.68e+37' },
      ],
    });
    expect(result.statistics?.general['遺産の始まり：']).toEqual({
      innerText: ' 362日前, 昇天 107回',
      ascensions: 107,
      daysAgo: 362,
    });
    expect(result.statistics?.general['クリック回数：']).toEqual({
      innerText: ' 1,009',
      value: 1009,
    });
    expect(result.statistics?.general['貯まったクッキー：']).toEqual({
      innerText: ' 9.68e+37',
    });
  });


  it("builds newsLines from child lines", () => {
    const result = buildSightResult({
      ...baseSightRawData,
      commentsText1: "ニュース1",
      commentsText2: "ニュース2",
      commentsText: "親の全文",
    });
    expect(result.newsLines).toEqual(["ニュース1", "ニュース2"]);
  });

  it("builds newsLines from commentsText fallback when child lines are empty", () => {
    const result = buildSightResult({
      ...baseSightRawData,
      commentsText1: undefined,
      commentsText2: "  ",
      commentsText: "一行目\n二行目\n",
    });
    expect(result.newsLines).toEqual(["一行目", "二行目"]);
  });

  it("builds empty newsLines when no news text is present", () => {
    const result = buildSightResult({
      ...baseSightRawData,
      commentsText1: undefined,
      commentsText2: undefined,
      commentsText: undefined,
    });
    expect(result.newsLines).toEqual([]);
  });
  it('sets statistics to undefined when no listings are provided', () => {
    const result = buildSightResult({ ...baseSightRawData, statisticsGeneralListings: undefined });
    expect(result.statistics).toBeUndefined();
  });
});

describe('enrichStatisticsGeneral', () => {
  it('parses ascensions and daysAgo from 遺産の始まり', () => {
    const result = enrichStatisticsGeneral({
      '遺産の始まり：': { innerText: ' 362日前, 昇天 107回' },
    });
    expect(result['遺産の始まり：']).toEqual({
      innerText: ' 362日前, 昇天 107回',
      ascensions: 107,
      daysAgo: 362,
    });
  });

  it('parses ascensions without daysAgo when only 昇天 is present', () => {
    const result = enrichStatisticsGeneral({
      '遺産の始まり：': { innerText: ' 昇天 1,234回' },
    });
    expect(result['遺産の始まり：']).toEqual({
      innerText: ' 昇天 1,234回',
      ascensions: 1234,
    });
  });

  it('leaves 遺産の始まり as innerText-only when ascensions cannot be parsed', () => {
    const result = enrichStatisticsGeneral({
      '遺産の始まり：': { innerText: ' 362日前' },
    });
    expect(result['遺産の始まり：']).toEqual({
      innerText: ' 362日前',
    });
  });

  it('parses クリック回数 with comma separators', () => {
    const result = enrichStatisticsGeneral({
      'クリック回数：': { innerText: ' 1,009' },
    });
    expect(result['クリック回数：']).toEqual({
      innerText: ' 1,009',
      value: 1009,
    });
  });

  it('parses クリック回数 without commas', () => {
    const result = enrichStatisticsGeneral({
      'クリック回数：': { innerText: ' 42' },
    });
    expect(result['クリック回数：']).toEqual({
      innerText: ' 42',
      value: 42,
    });
  });

  it('leaves クリック回数 as innerText-only when not a number', () => {
    const result = enrichStatisticsGeneral({
      'クリック回数：': { innerText: ' 不明' },
    });
    expect(result['クリック回数：']).toEqual({
      innerText: ' 不明',
    });
  });

  it('does not mutate the input object', () => {
    const input = {
      'クリック回数：': { innerText: ' 10' },
      '貯まったクッキー：': { innerText: ' 1e+10' },
    };
    const snapshot = structuredClone(input);
    enrichStatisticsGeneral(input);
    expect(input).toEqual(snapshot);
  });

  it('passes through unrelated keys unchanged', () => {
    const result = enrichStatisticsGeneral({
      'Cookie clicks': { innerText: ' 42' },
      '所有建物：': { innerText: ' 457' },
    });
    expect(result).toEqual({
      'Cookie clicks': { innerText: ' 42' },
      '所有建物：': { innerText: ' 457' },
    });
  });
});

describe("parseNewsLines", () => {
  it("prefers child lines over fallback", () => {
    expect(parseNewsLines("行1", "行2", "無視\nされる")).toEqual(["行1", "行2"]);
  });
  it("falls back to splitting commentsText", () => {
    expect(parseNewsLines(undefined, undefined, "a\nb\n")).toEqual(["a", "b"]);
  });
  it("drops empty lines", () => {
    expect(parseNewsLines("  ", "本体", undefined)).toEqual(["本体"]);
  });
});