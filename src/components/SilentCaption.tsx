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
  // レイアウト上の位置は変えず、描画だけ親内へ平行移動
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
  // 拡大後も親矩形に収まりやすい上限（はみ出しは transform のためレイアウト非影響）
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

/**
 * SILENT 字幕用。transform のみ動かすのでパネル（親）のレイアウトサイズは変わらない。
 * テキストのはみ出しは overflow 側の都合で許容。
 */
export function SilentCaption({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const el = textRef.current;
    if (!wrap || !el) return;

    const ac = new AbortController();
    const { signal } = ac;

    const loop = async () => {
      try {
        el.style.transform = IDENTITY;
        await sleep(PAUSE_MS, signal);

        while (!signal.aborted) {
          const mode = pickMode();
          let outbound = IDENTITY;

          if (mode === "translate") {
            const { x, y } = randomTranslate(el, wrap);
            outbound = `translate(${x}px, ${y}px) rotate(0deg) scale(1)`;
          } else if (mode === "rotate") {
            const deg = randomRotateDeg(el, wrap);
            outbound = `translate(0px, 0px) rotate(${deg}deg) scale(1)`;
          } else {
            const s = randomScale(el, wrap);
            outbound = `translate(0px, 0px) rotate(0deg) scale(${s})`;
          }

          await animateTo(el, outbound, MOVE_MS, signal);
          await sleep(HOLD_MS, signal);
          await animateTo(el, IDENTITY, MOVE_MS, signal);
          await sleep(PAUSE_MS, signal);
        }
      } catch {
        // abort: SILENT 解除・字幕切替 → 戻し不要
      }
    };

    void loop();
    return () => {
      ac.abort();
    };
  }, [text]);

  return (
    // レイアウトサイズは中のテキストの通常サイズのみ。transform は描画だけ。
    <div ref={wrapRef} className="relative w-full min-w-0">
      <div
        ref={textRef}
        className="inline-block max-w-full will-change-transform origin-center"
        style={{ transform: IDENTITY }}
      >
        {text}
      </div>
    </div>
  );
}
