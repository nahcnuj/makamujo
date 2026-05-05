/**
 * This file is the entry point for the app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */
/** @jsxImportSource hono/jsx/dom */

import { render } from "hono/jsx/dom";
import { App } from "./App";

function start() {
  const el = document.getElementById("root");
  if (!el) throw new Error("root element not found");
  render(<App />, el);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
