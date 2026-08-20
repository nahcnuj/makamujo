import { useEffect, useRef } from "hono/jsx/dom";

const HOLD_MS = 800;
const MOVE_MS = 1200;
const PAUSE_MS = 1500;

type Mode = "translate" | "rotate" | "scale";

function pickMode(): Mode {
  const r = Math.random();
  if (r < 1 / 3) return "translate";
  if (r < 2 / 3) return "rotate";
  return "scale";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function randomTranslate(el: HTMLElement, parent: HTMLElement) {
  const er = el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const maxX = Math.max(0, pr.width - er.width);
  const maxY = Math.max(0, pr.height - er.height);
  const curLeft = er.left - pr.left;
  const curTop = er.top - pr.top;
  const targetX = Math.random() * maxX;
  const targetY = Math.random() * maxY;
  return { x: targetX - curLeft, y: targetY - curTop };
}

function randomScale(el: HTMLElement, parent: HTMLElement) {
  const er = el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const maxByW = er.width > 0 ? pr.width / er.width : 1.2;
  const maxByH = er.height > 0 ? pr.height / er.height : 1.2;
  const maxScale = Math.max(1.05, Math.min(maxByW, maxByH, 1.8));
  return 1 + Math.random() * (maxScale - 1);
}

function randomRotateDeg(el: HTMLElement, parent: HTMLElement) {
  const er = el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const slack = Math.min(
    pr.width / Math.max(er.width, 1),
    pr.height / Math.max(er.height, 1),
  );
  const maxDeg = clamp(slack * 25, 8, 35);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * (8 + Math.random() * (maxDeg - 8));
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

/** SILENT caption: body portal + origin top-left (parent overflow-hidden safe). */
export function SilentCaption({ text }: { text: string }) {
  const measureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

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
      "position:fixed;transform-origin:top left;will-change:transform;white-space:normal;pointer-events:none;";
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

    const boundsParent = measure.parentElement ?? measure;

    const loop = async () => {
      try {
        el.style.transform = IDENTITY;
        await sleep(PAUSE_MS, signal);
        while (!signal.aborted) {
          syncPos();
          const mode = pickMode();
          let outbound = IDENTITY;
          if (mode === "translate") {
            const { x, y } = randomTranslate(el, boundsParent);
            outbound = `translate(${x}px, ${y}px) rotate(0deg) scale(1)`;
          } else if (mode === "rotate") {
            const deg = randomRotateDeg(el, boundsParent);
            outbound = `translate(0px, 0px) rotate(${deg}deg) scale(1)`;
          } else {
            const s = randomScale(el, boundsParent);
            outbound = `translate(0px, 0px) rotate(0deg) scale(${s})`;
          }
          await animateTo(el, outbound, MOVE_MS, signal);
          await sleep(HOLD_MS, signal);
          await animateTo(el, IDENTITY, MOVE_MS, signal);
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
    };
  }, [text]);

  return (
    <div className="relative w-full min-w-0">
      <div
        ref={measureRef}
        className="inline-block max-w-full invisible"
        aria-hidden="true"
      >
        {text}
      </div>
    </div>
  );
}
