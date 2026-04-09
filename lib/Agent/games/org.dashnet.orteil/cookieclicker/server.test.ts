import { describe, expect, it } from "bun:test";
import { collectClickableElementIds } from "./server";

type ElementLike = Parameters<typeof collectClickableElementIds>[0];
type StyleLike = Pick<CSSStyleDeclaration, 'cursor' | 'pointerEvents'>;

const makeElement = (
  id: string,
  {
    visible = true,
    cursor = 'pointer',
    pointerEvents = 'auto',
    parentElement = null,
    children = [] as ElementLike[],
  }: {
    visible?: boolean;
    cursor?: string;
    pointerEvents?: string;
    parentElement?: ElementLike | null;
    children?: ElementLike[];
  } = {},
): ElementLike & { querySelectorAll(selector: string): Iterable<ElementLike> } => {
  const el: ElementLike & { querySelectorAll(selector: string): Iterable<ElementLike>; _cursor: string; _pointerEvents: string } = {
    id,
    parentElement,
    checkVisibility: () => visible,
    querySelectorAll: () => children,
    _cursor: cursor,
    _pointerEvents: pointerEvents,
  };
  return el;
};

const makeGetComputedStyle = (styles: Map<ElementLike, StyleLike>) =>
  (el: ElementLike): StyleLike =>
    styles.get(el) ?? { cursor: 'default', pointerEvents: 'auto' };

const makeGameEl = (children: ElementLike[]) => {
  const gameEl: ElementLike & { querySelectorAll(selector: string): Iterable<ElementLike> } = {
    id: 'game',
    parentElement: null,
    checkVisibility: () => true,
    querySelectorAll: () => children,
  };
  return gameEl;
};

describe('collectClickableElementIds', () => {
  it('returns an empty array when there are no children', () => {
    const gameEl = makeGameEl([]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(new Map()));
    expect(result).toEqual([]);
  });

  it('includes a visible element with cursor:pointer', () => {
    const el = makeElement('bigCookie', { visible: true });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const gameEl = makeGameEl([el]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(result).toEqual(['bigCookie']);
  });

  it('excludes an element that fails checkVisibility (invisible)', () => {
    const el = makeElement('hidden', { visible: false });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    const gameEl = makeGameEl([el]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element with pointer-events:none', () => {
    const el = makeElement('noPE', { visible: true });
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'none' }] as const]);
    const gameEl = makeGameEl([el]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes an element without cursor:pointer', () => {
    const el = makeElement('noCursor', { visible: true });
    const styles = new Map([[el, { cursor: 'default', pointerEvents: 'auto' }] as const]);
    const gameEl = makeGameEl([el]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(result).toEqual([]);
  });

  it('excludes a child of a clickable ancestor (decorative child)', () => {
    const gameEl = makeGameEl([]);
    const parent = makeElement('gardenTile', { visible: true, parentElement: gameEl });
    const child = makeElement('gardenTileIcon', { visible: true, parentElement: parent });
    (gameEl as ReturnType<typeof makeGameEl>).querySelectorAll = () => [parent, child];
    const styles = new Map([
      [parent, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
      [child, { cursor: 'pointer', pointerEvents: 'auto' }] as const,
    ]);
    const result = collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(result).toEqual(['gardenTile']);
  });

  it('passes correct options to checkVisibility', () => {
    const receivedOpts: unknown[] = [];
    const el: ElementLike & { querySelectorAll(s: string): Iterable<ElementLike> } = {
      id: 'el',
      parentElement: null,
      checkVisibility: (opts) => { receivedOpts.push(opts); return true; },
      querySelectorAll: () => [],
    };
    const gameEl: typeof el & { querySelectorAll(s: string): Iterable<ElementLike> } = {
      id: 'game',
      parentElement: null,
      checkVisibility: () => true,
      querySelectorAll: () => [el],
    };
    const styles = new Map([[el, { cursor: 'pointer', pointerEvents: 'auto' }] as const]);
    collectClickableElementIds(gameEl, makeGetComputedStyle(styles));
    expect(receivedOpts).toEqual([{ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }]);
  });
});
