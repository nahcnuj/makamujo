/**
 * Re-exports AGT (automated-gameplay-transmitter) components with type
 * signatures compatible with hono/jsx/dom, enabling their use in JSX files
 * that use `@jsxImportSource hono/jsx/dom`.
 *
 * AGT's compiled dist imports hooks and JSX helpers from `react`. Bun.build's
 * `alias` option does not reliably redirect those imports for pre-compiled
 * packages in node_modules, so the actual React library ends up in the
 * browser bundle alongside hono/jsx/dom. Because hono/jsx/dom (not React) is
 * the active renderer, `ReactCurrentDispatcher.current` is always null and
 * any React hook call throws "Cannot read properties of null". Components and
 * hooks that use React hooks are therefore replaced with native hono/jsx/dom
 * equivalents below. AGT components that contain no hooks (Box, Container,
 * Layout, CharacterSprite) are still sourced from AGT; only their TypeScript
 * types are re-cast so that hono/jsx/dom JSX accepts them without errors.
 */
import type { Child, FC } from "hono/jsx/dom";
import {
  Box as _Box,
  Container as _Container,
  Layout as _Layout,
  CharacterSprite as _CharacterSprite,
} from "automated-gameplay-transmitter";
export { useInterval } from "./hooks/useInterval";
export { HighlightOnChange } from "./components/HighlightOnChange";

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
export const CharacterSprite = _CharacterSprite as unknown as HonoComponent<Parameters<typeof _CharacterSprite>[0]>;
