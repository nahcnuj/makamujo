/**
 * Re-exports AGT (automated-gameplay-transmitter) components with type
 * signatures compatible with hono/jsx/dom, enabling their use in JSX files
 * that use `@jsxImportSource hono/jsx/dom`.
 *
 * At runtime these are the real AGT components; the casts only affect
 * TypeScript's view of them.
 */
import type { Child, FC } from "hono/jsx/dom";
import {
  Box as _Box,
  Container as _Container,
  Layout as _Layout,
  HighlightOnChange as _HighlightOnChange,
  CharacterSprite as _CharacterSprite,
  useInterval,
} from "automated-gameplay-transmitter";

export { useInterval };

// Derive the valid hono component return type from FC so we stay aligned
// with hono's own type definitions without importing internal hono types.
type HonoReturn = ReturnType<FC<{}>>;

type HonoizeChildren<Props> = Omit<Props, 'children'> & { children?: Child };

// Cast to a hono-compatible function signature so that AGT's React-typed
// components are accepted by hono/jsx/dom JSX without TypeScript type errors.
// The component prop types are preserved from the original AGT exports,
// except React's `children` type is remapped to Hono's `Child`.
type HonoComponent<Props> = (props: HonoizeChildren<Props>) => HonoReturn;

export const Box = _Box as unknown as HonoComponent<Parameters<typeof _Box>[0]>;
export const Container = _Container as unknown as HonoComponent<Parameters<typeof _Container>[0]>;
export const Layout = _Layout as unknown as HonoComponent<Parameters<typeof _Layout>[0]>;
export const HighlightOnChange = _HighlightOnChange as unknown as HonoComponent<Parameters<typeof _HighlightOnChange>[0]>;
export const CharacterSprite = _CharacterSprite as unknown as HonoComponent<Parameters<typeof _CharacterSprite>[0]>;
