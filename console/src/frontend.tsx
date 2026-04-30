/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { App } from "./App";

function start() {
  const el = document.getElementById("root");
  if (!el) throw new Error("root element not found");
  const root = createRoot(el);
  root.render(createElement(App, null));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
