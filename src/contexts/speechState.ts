/**
 * Update displayed speech lines and `silent` from a `/api/speech` response.
 *
 * - ends with 「ありがとうございます！」 → interrupt (replace with that line)
 * - previous line ends with 「。」 → new topic (replace)
 * - otherwise → continuation (append)
 * - empty / silent → clear lines
 */
type SpeechPayload =
  | string
  | { text?: string; nodes?: readonly string[] }
  | { speech?: string; text?: string; nodes?: readonly string[] };

const normalizeSpeechText = (
  speech: SpeechPayload | undefined,
): string | undefined => {
  if (typeof speech === "string") {
    return speech;
  }

  if (!speech || typeof speech !== "object") {
    return undefined;
  }

  if ("text" in speech && typeof speech.text === "string") {
    return speech.text;
  }

  if ("speech" in speech && typeof speech.speech === "string") {
    return speech.speech;
  }

  return undefined;
};

const isThanksInterrupt = (text: string): boolean =>
  text.trimEnd().endsWith("ありがとうございます！");

const isTopicEnd = (text: string): boolean =>
  text.trimEnd().endsWith("。") ||
  text.trimEnd().endsWith("ありがとうございます！");

export function updateSpeechState(
  res: { speech?: SpeechPayload; silent?: boolean },
  currentLines: string[],
  setSpeechLines: (lines: string[]) => void,
  setSilent: (silent: boolean) => void,
): void {
  const isSilent = !!res.silent;

  setSilent(isSilent);

  if (isSilent) {
    if (currentLines.length > 0) {
      setSpeechLines([]);
    }
    return;
  }

  if (res.speech !== undefined) {
    const newSpeech = normalizeSpeechText(res.speech) ?? "";

    if (newSpeech === "") {
      if (currentLines.length > 0) {
        setSpeechLines([]);
      }
      return;
    }

    const last = currentLines.at(-1);
    if (last === newSpeech) {
      return;
    }

    if (isThanksInterrupt(newSpeech)) {
      setSpeechLines([newSpeech]);
      return;
    }

    if (last !== undefined && isTopicEnd(last)) {
      setSpeechLines([newSpeech]);
      return;
    }

    setSpeechLines([...currentLines, newSpeech].slice(-2));
  }
}
