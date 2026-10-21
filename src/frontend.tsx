/**
 * This file is the entry point for the app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */
import { FrontendRoot } from "./frontendRoot";
import { mount } from "./mount";

function start() {
  const el = document.getElementById("root");
  if (!el) throw new Error("root element not found");
  mount(<FrontendRoot />, el);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
