/** サーバー SILENCE_THRESHOLD_MS と揃える（5分） */
export const SPRITE_HIDE_THRESHOLD_MS = 5 * 60 * 1_000;
/** 暗くなるときだけ約2.5分かけて brightness を落とす */
export const FADE_OUT_MS = 2.5 * 60 * 1_000;

export type SpriteVisibility = {
  spriteHidden: boolean;
  /** true のときだけ transition を付ける（復帰は即 brightness 1） */
  fadingOut: boolean;
};

export const VISIBLE: SpriteVisibility = {
  spriteHidden: false,
  fadingOut: false,
};

/** 沈黙中に来場者数が変わった直後の「即表示→すぐフェード開始」用 */
export const SHOW_THEN_FADE: SpriteVisibility = {
  spriteHidden: true,
  fadingOut: true,
};

export const HIDDEN_FADING: SpriteVisibility = {
  spriteHidden: true,
  fadingOut: true,
};

export function isListenersStale(
  listenersChangedAtMs: number,
  nowMs: number,
  thresholdMs: number = SPRITE_HIDE_THRESHOLD_MS,
): boolean {
  return nowMs - listenersChangedAtMs >= thresholdMs;
}

/**
 * 来場者数の更新を処理する。
 * - 値未定義 / 変化なし → null（何もしない）
 * - 変化あり → 新しい changedAt と表示状態
 */
export function onListenersUpdate(input: {
  silent: boolean;
  listeners: number | undefined;
  prevListeners: number | undefined;
  nowMs: number;
}): { prevListeners: number; listenersChangedAtMs: number; visibility: SpriteVisibility } | null {
  const { silent, listeners, prevListeners, nowMs } = input;
  if (listeners === undefined) return null;
  if (prevListeners === listeners) return null;

  return {
    prevListeners: listeners,
    listenersChangedAtMs: nowMs,
    visibility: silent ? SHOW_THEN_FADE : VISIBLE,
  };
}

/**
 * 沈黙フラグと stale 判定から表示状態を決める。
 * - !silent → 常に表示
 * - silent && stale → フェードして非表示
 * - silent && !stale → 表示のまま（待ち）
 */
export function visibilityFromSilenceClock(input: {
  silent: boolean;
  listenersChangedAtMs: number;
  nowMs: number;
  thresholdMs?: number;
}): SpriteVisibility {
  if (!input.silent) return VISIBLE;
  if (
    isListenersStale(
      input.listenersChangedAtMs,
      input.nowMs,
      input.thresholdMs ?? SPRITE_HIDE_THRESHOLD_MS,
    )
  ) {
    return HIDDEN_FADING;
  }
  return VISIBLE;
}

/** 不在時は brightness を落とす（opacity ではなく照明が落ちるイメージ） */
export function spriteAwayStyle(
  visibility: SpriteVisibility,
  fadeOutMs: number = FADE_OUT_MS,
): { filter: string; transition: string } {
  return {
    filter: visibility.spriteHidden ? "brightness(0)" : "brightness(1)",
    transition: visibility.fadingOut ? `filter ${fadeOutMs}ms linear` : "none",
  };
}