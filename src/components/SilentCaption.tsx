import { useEffect, useRef } from "hono/jsx/dom";

const HOLD_MS = 800;
const MOVE_MS = 1200;
const PAUSE_MS = 1500;

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

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function animateTo(
  el: HTMLElement,
  transform: string,
  ms: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const from = getComputedStyle(el).transform;
  const anim = el.animate(
    [{ transform: from === "none" ? "none" : from }, { transform }],
    {
      duration: ms,
      easing: "linear",
      fill: "forwards",
    },
  );
  const onAbort = () => anim.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await anim.finished;
    el.style.transform = transform;
  } catch {
    throw new DOMException("aborted", "AbortError");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

const IDENTITY = "translate(0px, 0px) rotate(0deg) scale(1)";

export function SilentCaption({ text }: { text: string }) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    // すでに存在する場合は何もしない（正しい1つだけを維持）
    if (hostRef.current) return;

    const ac = new AbortController();
    const { signal } = ac;

    const host = document.createElement("div");
    host.setAttribute("data-silent-caption-portal", "");
    host.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:visible;";
    document.body.appendChild(host);
    hostRef.current = host;

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

    const loop = async () => {
      try {
        el.style.transform = IDENTITY;
        await sleep(PAUSE_MS, signal);
        while (!signal.aborted) {
          syncPos();
          const outbound = randomOutboundTransform();
          await animateTo(el, outbound.transform, outbound.ms, signal);
          await sleep(HOLD_MS, signal);
          await animateTo(el, IDENTITY, outbound.ms, signal);
          await sleep(PAUSE_MS, signal);
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
      hostRef.current = null;
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
