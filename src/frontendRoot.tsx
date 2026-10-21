import { type Child, ErrorBoundary } from "hono/jsx/dom";
import { App } from "./App";

/**
 * アプリの描画が例外で落ちたときの代替表示。
 * ページを空白のままにしない（鼓動の帯は HTML の静的な要素なので
 * 動き続けるが、表示の異常はそれとして画面に残す）。
 */
function RenderFailureNotice() {
  return (
    <div
      className="fixed bottom-2 left-2 z-40 rounded bg-black/60 px-2 py-1 text-xs text-emerald-200"
      aria-live="polite"
    >
      配信画面の描画に失敗しました
    </div>
  );
}

/**
 * アプリを ErrorBoundary で囲む。
 * 異常が throw されても fallback を示し、以降の再描画で復帰の間口を
 * 残す。鼓動の帯（`src/index.html` の静的な div）はここから独立している。
 */
export function AppBoundary({ children }: { children: Child }) {
  return (
    <ErrorBoundary
      fallback={<RenderFailureNotice />}
      onError={(error) => {
        console.error("[ERROR] frontend render failed", error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

/** `src/frontend.tsx` からマウントする画面の根。 */
export function FrontendRoot() {
  return (
    <AppBoundary>
      <App />
    </AppBoundary>
  );
}
