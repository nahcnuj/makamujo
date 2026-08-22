/**
 * This file is the entry point for the app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */
import { createRoot } from "hono/jsx/dom/client";
import { App } from "./App";

function start() {
  const el = document.getElementById("root");
  if (!el) throw new Error("root element not found");

  const root = createRoot(el);
  root.render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
