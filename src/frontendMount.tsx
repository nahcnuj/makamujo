import { ErrorBoundary } from "hono/jsx/dom";
import { App } from "./App";
import { BroadcastHeartbeat } from "./components/BroadcastHeartbeat";
import { mount } from "./mount";

/** アプリ（コメント・発話・アバター状態）を描く root の id。 */
export const APP_ROOT_ID = "root";
/** 帯（配信映像が生きている印）を描く root の id。 */
export const BROADCAST_HEARTBEAT_ROOT_ID = "broadcast-heartbeat";

export interface FrontendMountOptions {
  /**
   * アプリの描画。差し替え口（テストから例外を投げられるようにするため）。
   */
  renderApp?: (container: HTMLElement) => void;
}

/**
 * 配信ページ（OBS の browser source が読むページ）を描画する。
 *
 * 帯はアプリとは別の root に描く。帯は「配信映像が生きている」ことを外から
 * 見せるためのもので、アプリ（コメント・発話・アバター状態）の描画が失敗して
 * も残らなければならない。アプリと同じ root に描くと、アプリの描画が 1 つでも
 * 例外を投げたときに帯まで消えて、合成出力は「ゲーム画面が静止したまま」止
 * まって見える（2026-10-22 01:28 の停止、issue #999）。帯を先に描いてから
 * アプリを描くので、アプリの描画が失敗しても「生きている印」は残る。
 */
export const mountFrontend = (
  doc: Document,
  options: FrontendMountOptions = {},
): void => {
  const heartbeatContainer = doc.getElementById(BROADCAST_HEARTBEAT_ROOT_ID);
  if (heartbeatContainer) {
    mount(<BroadcastHeartbeat />, heartbeatContainer);
  }

  const appContainer = doc.getElementById(APP_ROOT_ID);
  if (!appContainer) {
    throw new Error("root element not found");
  }
  const renderApp =
    options.renderApp ??
    ((container: HTMLElement) => {
      mount(
        <ErrorBoundary
          fallback={<div className="h-full" />}
          onError={(error) => {
            console.error("[ERROR] app render failed", error);
          }}
        >
          <App />
        </ErrorBoundary>,
        container,
      );
    });
  renderApp(appContainer);
};
