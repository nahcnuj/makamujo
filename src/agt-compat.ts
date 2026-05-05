/**
 * Re-exports AGT (automated-gameplay-transmitter) components with type
 * signatures compatible with hono/jsx/dom, enabling their use in JSX files
 * that use `@jsxImportSource hono/jsx/dom`.
 *
 * At runtime these are the real AGT components; the casts only affect
 * TypeScript's view of them.
 */
import type { FC } from "hono/jsx/dom";
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

// Cast to a hono-compatible function signature so that AGT's React-typed
// components are accepted by hono/jsx/dom JSX without TypeScript type errors.
// Prop shapes are not checked by TypeScript here; correctness is ensured at
// runtime via the Bun.build() `react → hono/jsx/dom` alias.
export const Box = _Box as unknown as (props: any) => HonoReturn;
export const Container = _Container as unknown as (props: any) => HonoReturn;
export const Layout = _Layout as unknown as (props: any) => HonoReturn;
export const HighlightOnChange = _HighlightOnChange as unknown as (props: any) => HonoReturn;
export const CharacterSprite = _CharacterSprite as unknown as (props: any) => HonoReturn;
