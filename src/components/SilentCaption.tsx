import { useEffect, useRef } from "hono/jsx/dom";

const MOVE_MS = 1200;

function randomTranslate() {
  const reachX = Math.max(80, window.innerWidth * 0.25);
  const upMax = window.innerHeight * 0.5;
  const downMax = Math.max(80, window.innerHeight * 0.25);
  return {
    x: (Math.random() * 2 - 1) * reachX,
    y: -upMax + Math.random() * (upMax + downMax),
  };
}

function randomScale() {
  return 1 + Math.random() * 0.6; // 1.0 .. 1.6
}

function randomRotateDeg() {
  const turns = 1 + Math.floor(Math.random() * 8);
  const sign = Math.random() < 0.5 ? -1 : 1;
  const extra = Math.random() * 360;
  return sign * (turns * 360 + extra);
}

const MAX_DEG_PER_SEC = 180;

function randomOutboundTransform() {
  const { x, y } = randomTranslate();
  const deg = randomRotateDeg();
  const s = randomScale();
  const transform = `translate(${x}px, ${y}px) rotate(${deg}deg) scale(${s})`;
  const ms = Math.max(
    MOVE_MS,
    Math.ceil((Math.abs(deg) / MAX_DEG_PER_SEC) * 1000),
  );
  return { transform, ms };
}

async function animateTo(
  el: HTMLElement,
  transform: string,
  ms: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError();
  const from = getComputedStyle(el).transform;
  const anim = el.animate(
    [{ transform: from === "none" ? "none" : from }, { transform }],
    {
      duration: ms,
      easing: "linear",
      fill: "forwards",
    },
  );
  signal.addEventListener("abort", () => anim.cancel(), { once: true });
  try {
    // anim.finished が abort しても解決しない実装（テスト環境の DOM 置き換え
    // など）があるため、abort をもう一方の選手として常に上書きして待つ。
    await abortable(anim.finished, signal);
    el.style.transform = transform;
  } catch {
    throw abortError();
  }
}

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    promise.then(resolve, () => reject(abortError()));
    signal.addEventListener(
      "abort",
      () => {
        reject(abortError());
      },
      { once: true },
    );
  });
}

const IDENTITY = "translate(0px, 0px) rotate(0deg) scale(1)";

function clearSilentCaptionPortals() {
  document.querySelectorAll("[data-silent-caption-portal]").forEach((el) => {
    el.remove();
  });
}

export function SilentCaption({ text }: { text: string }) {
  const measureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    // 増殖防止: 既存ポータルをすべて削除してから1つだけ作る
    clearSilentCaptionPortals();

    const ac = new AbortController();
    const { signal } = ac;

    const host = document.createElement("div");
    host.setAttribute("data-silent-caption-portal", "");
    host.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:visible;";
    document.body.appendChild(host);

    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      "position:fixed;transform-origin:top left;will-change:transform;white-space:nowrap;pointer-events:none;";
    const cs = getComputedStyle(measure);
    el.style.font = cs.font;
    el.style.fontSize = cs.fontSize;
    el.style.lineHeight = cs.lineHeight;
    el.style.color = cs.color;
    el.style.fontWeight = cs.fontWeight;
    el.style.letterSpacing = cs.letterSpacing;
    host.appendChild(el);

    const syncPos = () => {
      const r = measure.getBoundingClientRect();
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.width = `${r.width}px`;
      el.style.maxWidth = `${r.width}px`;
    };
    syncPos();
    window.addEventListener("resize", syncPos);
    window.addEventListener("scroll", syncPos, true);

    // 提示画面が静止画にならないよう、視覚の休み（止まったフレーム）を挟まず、
    // 出口 → 定位置 → 出口の往復を連続で動かし続ける。合成出力の静止は配信の
    // 不調として検知されるので、静止した時間帯を作らない（issue #982）。
    const loop = async () => {
      try {
        el.style.transform = IDENTITY;
        while (!signal.aborted) {
          // マイクロタスクだけで回すと（アニメーションが即時解決する環境で）
          // イベントループが枯渇するため、各往復の間にイベントループへ譲る。
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
          if (signal.aborted) break;
          syncPos();
          const outbound = randomOutboundTransform();
          await animateTo(el, outbound.transform, outbound.ms, signal);
          await animateTo(el, IDENTITY, outbound.ms, signal);
        }
      } catch {
        // abort
      }
    };

    void loop();

    return () => {
      ac.abort();
      window.removeEventListener("resize", syncPos);
      window.removeEventListener("scroll", syncPos, true);
      host.remove();
      clearSilentCaptionPortals();
    };
  }, [text]);

  return (
    <div className="relative w-full min-w-0">
      <div
        ref={measureRef}
        className="inline-block max-w-full"
        aria-hidden="true"
        style={{
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {text}
      </div>
    </div>
  );
}
