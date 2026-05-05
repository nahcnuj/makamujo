/** @jsxImportSource hono/jsx */
/**
 * Provides AGT (automated-gameplay-transmitter) component equivalents as
 * native hono/jsx components for the management console.
 *
 * AGT's Container is a simple `div.h-full.p-1.overflow-hidden` wrapper.
 * We re-implement it natively in hono/jsx so that:
 *   - Tests (SSR via hono/jsx) render it correctly as HTML.
 *   - The browser bundle (built with Bun.build hono/jsx → hono/jsx/dom alias)
 *     uses the same DOM-compatible implementation.
 */
import type { FC, PropsWithChildren } from "hono/jsx";

/**
 * Layout container matching AGT's Container: full-height, padded, no overflow.
 */
export const Container: FC<PropsWithChildren> = ({ children }) => (
  <div class="h-full p-1 overflow-hidden">{children}</div>
);
