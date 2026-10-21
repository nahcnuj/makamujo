/**
 * 常時流れる帯（`src/components/BroadcastHeartbeat.tsx`）が、外からの配信異常
 * 検知（`scripts/check-stream.ts`）の判定を本当に満たせるかを、外から観測した
 * のと同じ計算で確かめるための純関数。
 *
 * 検知側（`scripts/check-stream.ts`）は配信画面を 128px まで縮小した 128x72 の
 * 絵に落として、前フレームと channel 差が 16 を超えたピクセルの割合が 0.001 を
 * 超えたフレームを「動いた」と数え、1 秒バケットごとに最少の移動フレーム数を
 * 出す。映像全体は 24 fps 超（左 60% のゲーム画面は 8 fps 超）が必要。
 *
 * 帯 1 本だけでこの閾値を超えるには、帯が捕捉範囲から外れる瞬間が無く、外れた
 * 瞬間も「絵が動いた」と数えられる強さが必要。帯が半透明だと OBS の Color Key
 * （key = 黒）に削られて検知側の差分に出ないことがあるため、キーで消える前提
 * でも閾値を超えることをこの純関数で確かめる。
 *
 * この純関数の絵は実際の Chromium の描画と突き合わせてある
 * （`broadcastHeartbeatLiveness.browser.test.ts`）。帯の動きは「上下の境目」が
 * 動いたことでしか差分に出ないので、1 行を 1 色にまとめると動きが消える。
 * ここでは 1 画素ごとに色を入れて、検知側と同じ粒度で比較する。
 */

export interface HeartbeatBandColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HeartbeatBandStop {
  /** 0 - 1 の位置（上端が 0）。 */
  offset: number;
  color: HeartbeatBandColor;
}

export interface HeartbeatBandSpec {
  /** 帯の上端が出発する位置（vh）。 */
  fromVh: number;
  /** 帯の上端が到達する位置（vh）。 */
  toVh: number;
  /** 帯の高さ（vh）。 */
  heightVh: number;
  /** 1 周する時間（ミリ秒）。 */
  durationMs: number;
  /** 上下方向のグラデーションの停止位置。 */
  stops: readonly HeartbeatBandStop[];
}

export interface HeartbeatLivenessOptions {
  /** 配信ページ（OBS の browser source）の幅（px）。 */
  pageWidth?: number;
  /** 配信ページの高さ（px）。 */
  pageHeight?: number;
  /** 検知側の縮小後の幅（px）。`scripts/check-stream.ts` は 128。 */
  sampleWidth?: number;
  /** 検知側の縮小後の高さ（px）。 */
  sampleHeight?: number;
  /** 帯の fps。OBS の browser source は 30。 */
  fps?: number;
  /** 判定する窓（ミリ秒）。 */
  windowMs?: number;
  /** 帯の背後（静止したゲーム画面）の色。 */
  background?: HeartbeatBandColor;
  /**
   * OBS の Color Key（key = 黒）相当。検知側の絵にはキー後の色しか残らない
   * ため、キーの前提を無視した判定は本番より楽観的になる。
   * `threshold` 0 はキーなし。
   */
  colorKey?: ColorKey;
}

export interface HeartbeatLivenessSummary {
  /** 1 秒バケットで最少の移動フレーム数。検知側の `minFps` と同じ。 */
  minFps: number;
  /** 窓全体での移動フレーム数 per second。 */
  avgFps: number;
  /** 動いたフレーム数。 */
  changedFrames: number;
  /** 比較したフレーム数。 */
  comparedFrames: number;
  /** ゲーム画面（左 gameWidthRatio）で最少の移動フレーム数。 */
  gameMinFps: number;
}

const DEFAULT_PAGE_WIDTH = 1280;
const DEFAULT_PAGE_HEIGHT = 720;
const DEFAULT_SAMPLE_WIDTH = 128;
const DEFAULT_SAMPLE_HEIGHT = 72;
const DEFAULT_FPS = 30;
const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_GAME_WIDTH_RATIO = 0.6;
const DEFAULT_BACKGROUND: HeartbeatBandColor = { r: 0, g: 0, b: 0, a: 1 };
/** 検知側の channel 差の許容（`scripts/check-stream.ts` と同じ）。 */
export const HEARTBEAT_CHANNEL_TOLERANCE = 16;
/** 検知側の「動いた」とみなすピクセルの割合（`scripts/check-stream.ts` と同じ）。 */
export const HEARTBEAT_MIN_CHANGED_RATIO = 0.001;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * CSS 1 枚の `rgba()` を 0 - 1 の成分に分解する。
 */
const parseRgba = (raw: string): HeartbeatBandColor | undefined => {
  const match = raw.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (!match) return undefined;
  const [, r, g, b, a] = match;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return {
    r: Number(r) / 255,
    g: Number(g) / 255,
    b: Number(b) / 255,
    a: a === undefined ? 1 : Number(a),
  };
};

/**
 * `src/index.css` の帯（`.broadcast-heartbeat` と
 * `@keyframes broadcast-heartbeat-sweep`）を読み取って仕様にする。
 *
 * CSS を唯一の源として扱う: 帯の動きを CSS で変えたら、この関数がその
 * movement をそのまま評価する。
 */
export const parseHeartbeatBandSpec = (css: string): HeartbeatBandSpec => {
  const keyframes = css.match(
    /@keyframes\s+broadcast-heartbeat-sweep\s*\{([\s\S]*?)\n\}/,
  );
  if (!keyframes?.[1]) {
    throw new Error("broadcast-heartbeat-sweep keyframes not found");
  }
  const from = keyframes[1].match(
    /from\s*\{[^}]*translateY\(\s*(-?[\d.]+)vh\s*\)/,
  );
  const to = keyframes[1].match(/to\s*\{[^}]*translateY\(\s*(-?[\d.]+)vh\s*\)/);
  if (!from?.[1] || !to?.[1]) {
    throw new Error("broadcast-heartbeat-sweep translateY not found");
  }

  const block = css.match(/\.broadcast-heartbeat\s*\{([\s\S]*?)\n\}/);
  if (!block?.[1]) {
    throw new Error(".broadcast-heartbeat rule not found");
  }
  const height = block[1].match(/height:\s*([\d.]+)vh/);
  if (!height?.[1]) {
    throw new Error(".broadcast-heartbeat height not found");
  }
  const animation = block[1].match(
    /animation:\s*[\w-]+\s+([\d.]+)s\s+[\w-]+\s+([\w-]+)/,
  );
  if (!animation?.[1]) {
    throw new Error(".broadcast-heartbeat animation duration not found");
  }
  const loop = animation[2];
  if (loop !== "infinite") {
    throw new Error(`broadcast-heartbeat animation must loop: ${loop}`);
  }

  const gradient = block[1].match(/linear-gradient\(([\s\S]*?)\)\s*;/);
  if (!gradient?.[1]) {
    throw new Error(".broadcast-heartbeat gradient not found");
  }
  const stops: HeartbeatBandStop[] = [];
  const stopPattern = /(rgba?\([^)]*\))\s*(-?[\d.]+)%/g;
  let stopMatch = stopPattern.exec(gradient[1]);
  while (stopMatch) {
    const color = parseRgba(stopMatch[1] ?? "");
    const offset = stopMatch[2];
    if (color && offset !== undefined) {
      stops.push({ offset: Number(offset) / 100, color });
    }
    stopMatch = stopPattern.exec(gradient[1]);
  }
  if (stops.length < 2) {
    throw new Error(".broadcast-heartbeat gradient stops not found");
  }

  return {
    fromVh: Number(from[1]),
    toVh: Number(to[1]),
    heightVh: Number(height[1]),
    durationMs: Number(animation[1]) * 1000,
    stops,
  };
};

/**
 * グラデーションの位置（0 - 1）の色。停止位置の間は線形に補間する
 * （ブラウザの `linear-gradient` と同じ扱い）。
 */
const colorAt = (
  stops: readonly HeartbeatBandStop[],
  offset: number,
): HeartbeatBandColor => {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (offset <= first.offset) return first.color;
  if (offset >= last.offset) return last.color;
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (!previous || !current) continue;
    if (offset > current.offset) continue;
    const span = current.offset - previous.offset;
    const ratio = span <= 0 ? 0 : (offset - previous.offset) / span;
    return {
      r: previous.color.r + (current.color.r - previous.color.r) * ratio,
      g: previous.color.g + (current.color.g - previous.color.g) * ratio,
      b: previous.color.b + (current.color.b - previous.color.b) * ratio,
      a: previous.color.a + (current.color.a - previous.color.a) * ratio,
    };
  }
  return last.color;
};

/** 背景の上に半透明の色を重ねる（ブラウザの `source-over` と同じ）。 */
const compositeOver = (
  top: HeartbeatBandColor,
  bottom: HeartbeatBandColor,
): HeartbeatBandColor => {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  };
};

/**
 * 帯の上端の位置（px）を返す。`linear` なので周期内で一直線。
 */
const bandOffsetPx = (
  spec: HeartbeatBandSpec,
  elapsedMs: number,
  pageHeight: number,
): number => {
  const phase = (elapsedMs % spec.durationMs) / spec.durationMs;
  const vh = spec.fromVh + (spec.toVh - spec.fromVh) * phase;
  return (vh / 100) * pageHeight;
};

/**
 * OBS の Color Key（key = 黒）。`similarity` は 0 - 1000（既定 400）で、
 * 鍵の色からの YCbCr 距離がこの値 / 1000 を超えた画素だけが残る。
 */
export interface ColorKey {
  /** 0 - 1 の距離閾値。0 はキーなし。 */
  threshold: number;
  /** 鍵の色。 */
  color?: HeartbeatBandColor;
}

/** OBS の Color Key の既定の類似度（400 / 1000）。 */
export const DEFAULT_COLOR_KEY_THRESHOLD = 0.4;

const toYcbcr = (color: HeartbeatBandColor): [number, number, number] => {
  const y = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  const u = -0.14713 * color.r - 0.28886 * color.g + 0.43593 * color.b + 0.5;
  const v = 0.615 * color.r - 0.51499 * color.g - 0.10001 * color.b + 0.5;
  return [y, u, v];
};

/**
 * 鍵の色に近い画素を背景へ差し替える（OBS の Color Key 相当）。
 */
const applyKey = (
  color: HeartbeatBandColor,
  key: ColorKey,
): HeartbeatBandColor => {
  if (key.threshold <= 0) return color;
  const [y, u, v] = toYcbcr(color);
  const [keyY, keyU, keyV] = toYcbcr(key.color ?? { r: 0, g: 0, b: 0, a: 1 });
  const distance = Math.sqrt(
    (y - keyY) ** 2 + (u - keyU) ** 2 + (v - keyV) ** 2,
  );
  if (distance >= key.threshold) return color;
  return { r: 0, g: 0, b: 0, a: 0 };
};

/** 検知側の縮小（128x72）後の 1 フレーム。 */
export interface HeartbeatFrame {
  width: number;
  height: number;
  /** RGB（0 - 1）を row-major で並べた buffer。 */
  data: Float32Array;
}

/**
 * 検知側の縮小（128x72）後の 1 フレームを作る。
 *
 * 縮小的には「帯の上端・下端の境目」でピクセルの色が大きく変わる。帯が
 * 動いたことはこの境目が動いたことで検知側からは見えるので、行ごとの
 * 平均colour でsummarize すると動きが消えてしまう。ここでは 1 画素ずつ
 *  graded な色を入れて、検知側の比較と同じ粒度で差分が出るようにする。
 *
 * Color Key は OBS と同じく縮小前の画素単位で行う（鍵で消えた画素は
 * 背景が透ける）。
 */
export const sampleHeartbeatFrame = (
  spec: HeartbeatBandSpec,
  options: HeartbeatLivenessOptions & { elapsedMs?: number } = {},
): HeartbeatFrame => {
  const pageWidth = options.pageWidth ?? DEFAULT_PAGE_WIDTH;
  const pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;
  const sampleWidth = options.sampleWidth ?? DEFAULT_SAMPLE_WIDTH;
  const sampleHeight = options.sampleHeight ?? DEFAULT_SAMPLE_HEIGHT;
  const background = options.background ?? DEFAULT_BACKGROUND;
  const key: ColorKey = options.colorKey ?? { threshold: 0 };
  // 縮小は幅・高さそれぞれで独立に効くので、標本の縦横比がページと違うと
  // 「1 行あたり何 px」を決められない。帯は全幅なので縦横比だけが効く。
  if (Math.abs(pageWidth / pageHeight - sampleWidth / sampleHeight) > 0.01) {
    throw new Error("sample aspect ratio must match the page aspect ratio");
  }
  const bandHeightPx = (spec.heightVh / 100) * pageHeight;
  const bandTop = bandOffsetPx(spec, options.elapsedMs ?? 0, pageHeight);
  const data = new Float32Array(sampleWidth * sampleHeight * 3);
  for (let row = 0; row < sampleHeight; row += 1) {
    const pageY = (row + 0.5) * (pageHeight / sampleHeight);
    const insideBand = pageY >= bandTop && pageY < bandTop + bandHeightPx;
    const offset = bandHeightPx <= 0 ? 0 : (pageY - bandTop) / bandHeightPx;
    const band = insideBand
      ? colorAt(spec.stops, clamp(offset, 0, 1))
      : undefined;
    const composited = band ? compositeOver(band, background) : background;
    const keyed = applyKey(composited, key);
    for (let col = 0; col < sampleWidth; col += 1) {
      const index = (row * sampleWidth + col) * 3;
      data[index] = keyed.r;
      data[index + 1] = keyed.g;
      data[index + 2] = keyed.b;
    }
  }
  return { width: sampleWidth, height: sampleHeight, data };
};

/**
 * 検知側と同じ channel 差の許容で、前フレームから変わった画素を数える。
 */
export const countChangedPixels = (
  previous: HeartbeatFrame,
  current: HeartbeatFrame,
  tolerance: number = HEARTBEAT_CHANNEL_TOLERANCE,
): number => {
  const total = Math.min(
    previous.width * previous.height,
    current.width * current.height,
  );
  let changed = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    const index = pixel * 3;
    const previousR = previous.data[index] ?? 0;
    const previousG = previous.data[index + 1] ?? 0;
    const previousB = previous.data[index + 2] ?? 0;
    const currentR = current.data[index] ?? 0;
    const currentG = current.data[index + 1] ?? 0;
    const currentB = current.data[index + 2] ?? 0;
    if (
      Math.abs(previousR - currentR) * 255 > tolerance ||
      Math.abs(previousG - currentG) * 255 > tolerance ||
      Math.abs(previousB - currentB) * 255 > tolerance
    ) {
      changed += 1;
    }
  }
  return changed;
};

/**
 * 帯だけの絵を検知側の判定にかけられる形で評価する。
 *
 * 前提は「帯以外は完全に静止したゲーム画面」。検知側から見るとこれが
 * 一番厳しい条件（帯が動けば映像全体が動く）なので、ここを通れば
 * 実運用でも閾値を外れない。
 */
export const simulateHeartbeatLiveness = (
  spec: HeartbeatBandSpec,
  options: HeartbeatLivenessOptions = {},
): HeartbeatLivenessSummary => {
  const sampleWidth = options.sampleWidth ?? DEFAULT_SAMPLE_WIDTH;
  const sampleHeight = options.sampleHeight ?? DEFAULT_SAMPLE_HEIGHT;
  const fps = options.fps ?? DEFAULT_FPS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const gameWidthRatio = DEFAULT_GAME_WIDTH_RATIO;

  const gameWidth = Math.max(1, Math.floor(sampleWidth * gameWidthRatio));
  const total = sampleWidth * sampleHeight;
  const gameTotal = gameWidth * sampleHeight;

  const frameCount = Math.max(2, Math.round((windowMs / 1000) * fps));
  const bucketMs = 1000;
  const bucketCount = Math.max(1, Math.ceil(windowMs / bucketMs));
  const bucketChanged = new Array<number>(bucketCount).fill(0);
  const gameBucketChanged = new Array<number>(bucketCount).fill(0);

  let previousFrame: HeartbeatFrame | undefined;
  let changedFrames = 0;
  let comparedFrames = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const elapsedMs = (frame * 1000) / fps;
    const current = sampleHeartbeatFrame(spec, { ...options, elapsedMs });
    if (previousFrame) {
      let changed = 0;
      let gameChanged = 0;
      for (let row = 0; row < sampleHeight; row += 1) {
        for (let col = 0; col < sampleWidth; col += 1) {
          const index = (row * sampleWidth + col) * 3;
          const previousR = previousFrame.data[index] ?? 0;
          const previousG = previousFrame.data[index + 1] ?? 0;
          const previousB = previousFrame.data[index + 2] ?? 0;
          const currentR = current.data[index] ?? 0;
          const currentG = current.data[index + 1] ?? 0;
          const currentB = current.data[index + 2] ?? 0;
          const differs =
            Math.abs(previousR - currentR) * 255 >
              HEARTBEAT_CHANNEL_TOLERANCE ||
            Math.abs(previousG - currentG) * 255 >
              HEARTBEAT_CHANNEL_TOLERANCE ||
            Math.abs(previousB - currentB) * 255 > HEARTBEAT_CHANNEL_TOLERANCE;
          if (!differs) continue;
          changed += 1;
          if (col < gameWidth) gameChanged += 1;
        }
      }
      const bucketIndex = Math.min(
        Math.floor(elapsedMs / bucketMs),
        bucketCount - 1,
      );
      comparedFrames += 1;
      if (changed / total > HEARTBEAT_MIN_CHANGED_RATIO) {
        changedFrames += 1;
        bucketChanged[bucketIndex] = (bucketChanged[bucketIndex] ?? 0) + 1;
      }
      if (gameChanged / gameTotal > HEARTBEAT_MIN_CHANGED_RATIO) {
        gameBucketChanged[bucketIndex] =
          (gameBucketChanged[bucketIndex] ?? 0) + 1;
      }
    }
    previousFrame = current;
  }

  const minOf = (counts: number[]): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const count of counts) {
      min = Math.min(min, count);
    }
    return Number.isFinite(min) ? min : 0;
  };

  return {
    minFps: minOf(bucketChanged),
    avgFps: changedFrames / (windowMs / 1000),
    changedFrames,
    comparedFrames,
    gameMinFps: minOf(gameBucketChanged),
  };
};
