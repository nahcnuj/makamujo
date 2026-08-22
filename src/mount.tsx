import type { Child } from "hono/jsx";
import { createRoot, type Root } from "hono/jsx/dom/client";

/**
 * アプリ共通のマウントAPI。
 * フロントエンドもテストもこれを使うこと。
 * （スタンドアロンの render は使わない）
 */
export function mount(jsx: Child, container: HTMLElement): Root {
  const root = createRoot(container);
  root.render(jsx);
  return root;
}
