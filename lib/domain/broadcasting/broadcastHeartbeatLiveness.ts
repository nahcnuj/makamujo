/**
 * 配信映像の鼓動（帯）が「外からの配信異常検知に静止と数えられない」ための
 * 純ポリシー。
 *
 * 外からの配信異常検知（`scripts/check-stream.ts` は改変しない: owner 契約
 * #807）は、配信画面の映像を最大辺 128px の標本へ縮めて 1 秒バケットごとに
 * 比較する。あるフレームが「動いた」と数えられるのは、前フレームから
 * 16 を超える差のチャンネルを持つ画素が 0.1% 以上あるときだけで、1 バケット
 * には全体の 24 枚以上（`VIDEO_MIN_FPS`）、ゲーム部分（左 60%）の 8 枚以上
 * （`GAME_MIN_FPS`）が要る。**最悪のバケット**で判定するので、平均が足りて
 * いても 1 秒だけ止まれば停止と数えられる。
 *
 * 合成出力は「絵が動いているか」で判定される: ゲームが結果画面などで止まって
 * いる間は合成経路が壊れていなくても映像は静止し、その上、合成出力の静止は
 * 再起動では直らない（`architecture/README.md` の「配信画面の停止回復」）。
 * そこで配信オーバーレイは全幅の帯を流し続ける。帯が映像に動きを与える条件は
 * 次の 3 つに分解できる。
 *
 * 1. **中核が常に画面内にある。** 端まで出ると、その瞬間は帯が映像に存在
 *    せず、変化フレームが 0 枚になる。帯を画面外へ出してはいけない。
 * 2. **1 フレームで標本の 1 行を跨ぐ。** 標本は 720px を 72 行に縮める
 *    ため、1 行は画面高さの 1.39% である。1 フレームの移動がこれに届かな
 *    いと、変わるはずの画素が差分にならず、変化フレーム数が 24 枚を下回る。
 * 3. **中核のコントラストが判定の許容差を超える。** OBS の Color Key（黒）
 *    は暗い画素を消すので、中核は不透明で明るい色である必要がある。
 *
 * このモジュールは帯の形状から 1 番目と 2 番目を確かめ、3 番目（背景との差）
 * を入力にして、検知の判定式そのものを 1 秒バケットごとに再現する。帯の形は
 * CSS（`src/index.css`）と 1 対 1 で対応し、`src/broadcastHeartbeat.test.ts`
 * がその一致を検査する。
 */

/** RGB の色。0-255。 */
export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/**
 * 帯の形。画面の大きさは比（0-1）で表す。
 *
 * - `heightRatio`: 帯の高さ。
 * - `sweepFromRatio` / `sweepToRatio`: 走査の始点と終点（画面上端からの比）。
 * - `coreRatio`: 不透明な中核の高さ。OBS の Color Key で消えない部分だけを
 *   数えるため、半透明の縁は含めない。
 * - `durationMs`: 1 周期の長さ。
 * - `coreColor`: 中核の色。帯は画面（黒）の上に描かれるので、この色は
 *   そのまま配信画面に出る。
 */
export interface HeartbeatBandSpec {
  heightRatio: number;
  sweepFromRatio: number;
  sweepToRatio: number;
  coreRatio: number;
  durationMs: number;
  coreColor: RgbColor;
}

/**
 * 帯の仕様（`src/index.css` の `broadcast-heartbeat-sweep` と対応）。
 *
 * - 高さ 8vh、周期 1 秒で 92vh を走るので 1 フレームあたり 3.07vh 動き、
 *   720px を 72 行に縮めた標本では 2.2 行分（1 行を超える）。
 * - 走査は 0vh から 92vh まで。帯の高さが 8vh なので下端は 100vh に収まり、
 *   周期中ずっと画面内に収まる（画面外に出る瞬間を作らない）。
 * - 中核は不透明。OBS の Color Key（黒）に消されると動きにならない。
 */
export const BROADCAST_HEARTBEAT_BAND_SPEC: HeartbeatBandSpec = {
  heightRatio: 0.08,
  sweepFromRatio: 0,
  sweepToRatio: 0.92,
  coreRatio: 0.032,
  durationMs: 1_000,
  coreColor: { red: 52, green: 211, blue: 153 },
};

/**
 * 検知が要求する 1 秒あたりの変化フレーム数。
 *
 * `scripts/check-stream.ts` の `VIDEO_MIN_FPS` / `GAME_MIN_FPS` と同じ値。
 * そちらは owner 契約で改変できないため、値は複製せず
 * `lib/domain/broadcasting/broadcastHeartbeatLiveness.test.ts` が一致を検査
 * する。
 */
export const HEARTBEAT_VIDEO_MIN_FPS = 24;
export const HEARTBEAT_GAME_MIN_FPS = 8;

/** ゲーム部分（画面左 60%）の幅の比。 */
export const HEARTBEAT_GAME_WIDTH_RATIO = 0.6;

export interface HeartbeatLivenessOptions {
  /** 配信画面のピクセル幅（OBS の canvas は 1280）。 */
  videoWidth: number;
  /** 配信画面のピクセル高さ（OBS の canvas は 720）。 */
  videoHeight: number;
  /** 標本の最大辺（`scripts/check-stream.ts` の `MAX_SAMPLE_DIMENSION`）。 */
  maxSampleDimension: number;
  /** ゲーム部分の幅の比（左 60%）。 */
  gameWidthRatio: number;
  /** 配信映像のフレームレート（OBS の browser source は 30fps）。 */
  fps: number;
  /** 標本の採取フレームレート（ヘッドレス Chromium の rAF は 60fps）。 */
  samplingFps: number;
  /** 背景（ゲーム画面）の色。帯はこの色の上に乗る。 */
  backgroundColor: RgbColor;
  /** 画素の比較で許容する差（16）。 */
  channelTolerance: number;
  /** フレームを「動いた」と数えるのに必要な画素の割合（0.001）。 */
  minChangedRatio: number;
  /** 1 バケットの長さ（ミリ秒）。 */
  bucketMs: number;
  /** 観測する窓の長さ（ミリ秒）。 */
  windowMs: number;
}

/** 測定の既定値。検知の定数（`scripts/check-stream.ts`）に揃える。 */
export const DEFAULT_HEARTBEAT_LIVENESS_OPTIONS: HeartbeatLivenessOptions = {
  videoWidth: 1280,
  videoHeight: 720,
  maxSampleDimension: 128,
  gameWidthRatio: HEARTBEAT_GAME_WIDTH_RATIO,
  fps: 30,
  samplingFps: 60,
  backgroundColor: { red: 15, green: 20, blue: 25 },
  channelTolerance: 16,
  minChangedRatio: 0.001,
  bucketMs: 1_000,
  windowMs: 10_000,
};

/** 標本の大きさ。 */
export interface HeartbeatSampling {
  width: number;
  height: number;
  gameWidth: number;
}

/**
 * 標本の大きさを求める。最大辺を `maxSampleDimension` に収める。
 */
export const computeHeartbeatSampling = (
  options: HeartbeatLivenessOptions,
): HeartbeatSampling => {
  const { videoWidth, videoHeight, maxSampleDimension, gameWidthRatio } =
    options;
  const scale = maxSampleDimension / Math.max(videoWidth, videoHeight);
  const width = Math.max(1, Math.round(videoWidth * scale));
  const height = Math.max(1, Math.round(videoHeight * scale));
  const gameWidth = Math.max(1, Math.round(width * gameWidthRatio));
  return { width, height, gameWidth };
};

/** 帯の中核が占める位置（比）。 */
export interface HeartbeatCoreSpan {
  fromRatio: number;
  toRatio: number;
}

/**
 * 走査の位相から、中核の占める位置を求める。
 *
 * 位相 0 が走査の始点、1 が終点。走査は線形なので、終点から始点へ戻る
 * ときの飛びは「位置が急に変わる 1 フレーム」としてそのまま差分になる。
 */
export const coreSpanAtPhase = (
  spec: HeartbeatBandSpec,
  phase: number,
): HeartbeatCoreSpan => {
  const wrapped = ((phase % 1) + 1) % 1;
  const top =
    spec.sweepFromRatio + (spec.sweepToRatio - spec.sweepFromRatio) * wrapped;
  const inset = (spec.heightRatio - spec.coreRatio) / 2;
  return { fromRatio: top + inset, toRatio: top + inset + spec.coreRatio };
};

/**
 * 中核が画面外に出る時間の比。
 *
 * 0 なら帯は周期中ずっと画面内に収まる。端まで出る帯は、その瞬間の
 * 1 バケットを 0 枚にして停止と数えられる（issue #1009）。
 */
export const offScreenRatio = (spec: HeartbeatBandSpec): number => {
  const bottom = spec.sweepToRatio + spec.heightRatio;
  const top = spec.sweepFromRatio;
  if (top >= 0 && bottom <= 1) {
    return 0;
  }
  const travel = spec.sweepToRatio - spec.sweepFromRatio;
  if (travel <= 0) {
    return top < 0 || bottom > 1 ? 1 : 0;
  }
  // 画面外に出るのは、帯の上端が 0 未満のときと下端が 1 超のとき。
  const above = top < 0 ? Math.min(travel, -top) : 0;
  const below = bottom > 1 ? Math.min(travel, bottom - 1) : 0;
  return Math.min(1, (above + below) / travel);
};

/**
 * 1 フレームあたりの移動量（標本の行数）。
 *
 * 標本は 720px を 72 行に縮めるので 1 行は画面高さの 1.39%。1 フレームで
 * 1 行に届かないと、変わる画素が差分にならず変化フレーム数が減る。
 */
export const sampleRowsPerFrame = (
  spec: HeartbeatBandSpec,
  options: HeartbeatLivenessOptions,
): number => {
  const sampling = computeHeartbeatSampling(options);
  const travel = Math.abs(spec.sweepToRatio - spec.sweepFromRatio);
  const secondsPerFrame = 1 / options.fps;
  const movedRatio = (travel * secondsPerFrame) / (spec.durationMs / 1000);
  return movedRatio * sampling.height;
};

/** 1 標本の行の描画結果。 */
interface SampledRow {
  red: number;
  green: number;
  blue: number;
}

/**
 * 中核が各標本行をどれだけ覆うか（0-1）を求める。
 *
 * 標本は画面を 1 標本行ずつに区切って写すので、1 行ぶんの被覆はそのまま
 * 「その行の色が中核の色へ寄る量」になる。
 */
const coreCoveragePerRow = (
  span: HeartbeatCoreSpan,
  options: HeartbeatLivenessOptions,
): number[] => {
  const sampling = computeHeartbeatSampling(options);
  const sourceRows = options.videoHeight / sampling.height;
  const coreStart = span.fromRatio * options.videoHeight;
  const coreEnd = span.toRatio * options.videoHeight;
  const coverages: number[] = [];
  for (let row = 0; row < sampling.height; row += 1) {
    const rowStart = row * sourceRows;
    const rowEnd = rowStart + sourceRows;
    const overlap = Math.min(rowEnd, coreEnd) - Math.max(rowStart, coreStart);
    coverages.push(Math.max(0, Math.min(1, overlap / sourceRows)));
  }
  return coverages;
};

/** 中核が乗った標本行の色（背景の上に中核を重ねた色）。 */
const sampledRows = (
  spec: HeartbeatBandSpec,
  span: HeartbeatCoreSpan,
  options: HeartbeatLivenessOptions,
): SampledRow[] => {
  const coverages = coreCoveragePerRow(span, options);
  const background = options.backgroundColor;
  const core = spec.coreColor;
  return coverages.map((coverage) => ({
    red: background.red + (core.red - background.red) * coverage,
    green: background.green + (core.green - background.green) * coverage,
    blue: background.blue + (core.blue - background.blue) * coverage,
  }));
};

/** 1 標本（採取）の結果。 */
export interface HeartbeatSample {
  elapsedMs: number;
  wholeChanged: boolean;
  gameChanged: boolean;
}

/** 1 バケットの結果。 */
export interface HeartbeatBucket {
  wholeChangedFrames: number;
  gameChangedFrames: number;
}

/**
 * 帯が作る映像を、検知と同じ手順で標本に写して比較する。
 *
 * 採取は rAF（既定 60fps）、映像は 30fps なので、同じ映像フレームが 2 回
 * 続けて引かれる。その 2 回目の比較は差分にならないため、1 秒あたりの変化
 * フレーム数は映像のフレーム数で決まる。
 */
export const sampleHeartbeatPicture = (
  spec: HeartbeatBandSpec,
  options: HeartbeatLivenessOptions,
): HeartbeatSample[] => {
  const sampling = computeHeartbeatSampling(options);
  const totalPixels = sampling.width * sampling.height;
  const gamePixels = sampling.gameWidth * sampling.height;
  const samples: HeartbeatSample[] = [];
  let previousRows: SampledRow[] | undefined;
  let previousFrameIndex = -1;
  const sampleIntervalMs = 1000 / options.samplingFps;
  const frameIntervalMs = 1000 / options.fps;
  for (
    let elapsedMs = 0;
    elapsedMs < options.windowMs;
    elapsedMs += sampleIntervalMs
  ) {
    const frameIndex = Math.floor(elapsedMs / frameIntervalMs);
    const phase = (elapsedMs % spec.durationMs) / spec.durationMs;
    const span = coreSpanAtPhase(spec, phase);
    const rows = sampledRows(spec, span, options);
    if (previousRows !== undefined && frameIndex !== previousFrameIndex) {
      let wholeChangedPixels = 0;
      let gameChangedPixels = 0;
      for (let row = 0; row < sampling.height; row += 1) {
        const before = previousRows[row];
        const after = rows[row];
        if (before === undefined || after === undefined) {
          continue;
        }
        const changed =
          Math.abs(before.red - after.red) > options.channelTolerance ||
          Math.abs(before.green - after.green) > options.channelTolerance ||
          Math.abs(before.blue - after.blue) > options.channelTolerance;
        if (!changed) {
          continue;
        }
        wholeChangedPixels += sampling.width;
        gameChangedPixels += sampling.gameWidth;
      }
      samples.push({
        elapsedMs,
        wholeChanged:
          wholeChangedPixels / totalPixels > options.minChangedRatio,
        gameChanged: gameChangedPixels / gamePixels > options.minChangedRatio,
      });
    }
    previousRows = rows;
    previousFrameIndex = frameIndex;
  }
  return samples;
};

/** 標本を 1 秒バケットに切り、バケットごとの変化フレーム数を返す。 */
export const summarizeHeartbeatBuckets = (
  samples: HeartbeatSample[],
  options: HeartbeatLivenessOptions,
): HeartbeatBucket[] => {
  const bucketCount = Math.max(
    1,
    Math.ceil(options.windowMs / options.bucketMs),
  );
  const buckets: HeartbeatBucket[] = Array.from(
    { length: bucketCount },
    () => ({ wholeChangedFrames: 0, gameChangedFrames: 0 }),
  );
  for (const sample of samples) {
    const index = Math.min(
      bucketCount - 1,
      Math.floor(sample.elapsedMs / options.bucketMs),
    );
    const bucket = buckets[index];
    if (bucket === undefined) {
      continue;
    }
    if (sample.wholeChanged) {
      bucket.wholeChangedFrames += 1;
    }
    if (sample.gameChanged) {
      bucket.gameChangedFrames += 1;
    }
  }
  return buckets;
};

/** 帯の生存判定の結果。 */
export interface HeartbeatLivenessReport {
  /** 中核が周期中ずっと画面内に収まっているか。 */
  coreAlwaysOnScreen: boolean;
  /** 画面外に出る時間の比。 */
  offScreenRatio: number;
  /** 1 フレームあたりの移動量（標本の行数）。 */
  sampleRowsPerFrame: number;
  /** 最悪の 1 秒バケットで動いたフレーム数（全体 / ゲーム部分）。 */
  minWholeChangedFramesPerSecond: number;
  minGameChangedFramesPerSecond: number;
  /** 検知の要求を満たしているか。 */
  keepsPictureMoving: boolean;
  /** 満たしていない理由。 */
  reasons: string[];
}

/**
 * 帯の仕様と測定条件から、検知の要求を満たすか判定する。
 *
 * 判定は検知そのものと同じ手順（標本化 → 前標本との比較 → 1 秒バケット →
 * 最悪のバケット）で行う。
 */
export const evaluateHeartbeatLiveness = (
  spec: HeartbeatBandSpec,
  options: HeartbeatLivenessOptions = DEFAULT_HEARTBEAT_LIVENESS_OPTIONS,
): HeartbeatLivenessReport => {
  const reasons: string[] = [];
  const ratio = offScreenRatio(spec);
  const coreAlwaysOnScreen = ratio === 0;
  if (!coreAlwaysOnScreen) {
    reasons.push(
      `the band leaves the screen for ${(ratio * 100).toFixed(1)}% of the cycle`,
    );
  }
  const rows = sampleRowsPerFrame(spec, options);
  if (rows < 1) {
    reasons.push(
      `the band moves ${rows.toFixed(2)} sample rows per frame (1 row is required)`,
    );
  }
  const buckets = summarizeHeartbeatBuckets(
    sampleHeartbeatPicture(spec, options),
    options,
  );
  const minWhole = Math.min(
    ...buckets.map((bucket) => bucket.wholeChangedFrames),
  );
  const minGame = Math.min(
    ...buckets.map((bucket) => bucket.gameChangedFrames),
  );
  if (minWhole < HEARTBEAT_VIDEO_MIN_FPS) {
    reasons.push(
      `the slowest second changes ${minWhole} frames of the whole video (${HEARTBEAT_VIDEO_MIN_FPS} are required)`,
    );
  }
  if (minGame < HEARTBEAT_GAME_MIN_FPS) {
    reasons.push(
      `the slowest second changes ${minGame} frames of the game panel (${HEARTBEAT_GAME_MIN_FPS} are required)`,
    );
  }
  return {
    coreAlwaysOnScreen,
    offScreenRatio: ratio,
    sampleRowsPerFrame: rows,
    minWholeChangedFramesPerSecond: minWhole,
    minGameChangedFramesPerSecond: minGame,
    keepsPictureMoving: reasons.length === 0,
    reasons,
  };
};
