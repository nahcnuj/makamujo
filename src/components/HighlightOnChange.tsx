/** @jsxImportSource hono/jsx/dom */
import { useEffect, useState } from "hono/jsx/dom";
import type { Child } from "hono/jsx/dom";

type Props = {
  children?: Child;
  timeout: number;
  classNameOnChanged: string;
};

/**
 * A hono/jsx/dom-native re-implementation of AGT's HighlightOnChange.
 *
 * AGT's compiled dist imports `useState`/`useEffect` from `react`, which
 * Bun.build does not reliably redirect via its `alias` option for
 * pre-compiled packages. Using this local version avoids bundling actual
 * React alongside hono/jsx/dom, preventing "Cannot read properties of null"
 * runtime errors in OBS Browser.
 */
export function HighlightOnChange({ children, timeout, classNameOnChanged }: Props) {
  const [isHighlighting, setIsHighlighting] = useState(false);
  useEffect(() => {
    setIsHighlighting(true);
    const id = setTimeout(() => {
      setIsHighlighting(false);
    }, timeout);
    return () => {
      clearTimeout(id);
    };
  }, [children]);
  return <div class={isHighlighting ? classNameOnChanged : ""}>{children}</div>;
}
