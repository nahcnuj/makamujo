/**
 * Update `speech` and `silent` state from a `/api/speech` response.
 * `speech` is only replaced when the response contains a non-empty string, so
 * the display never goes blank between speech generations.
 */
type SpeechPayload =
  | string
  | { text?: string; nodes?: readonly string[] }
  | { speech?: string; text?: string; nodes?: readonly string[] };

const normalizeSpeechText = (speech: SpeechPayload | undefined): string | undefined => {
  if (typeof speech === 'string') {
    return speech;
  }

  if (!speech || typeof speech !== 'object') {
    return undefined;
  }

  if ('text' in speech && typeof speech.text === 'string') {
    return speech.text;
  }

  if ('speech' in speech && typeof speech.speech === 'string') {
    return speech.speech;
  }

  return undefined;
};

export function updateSpeechState(
  res: { speech?: SpeechPayload; silent?: boolean },
  currentSpeech: string,
  setSpeech: (speech: string) => void,
  setSilent: (silent: boolean) => void,
): void {
  const isSilent = !!res.silent;

  setSilent(isSilent);

  if (isSilent) {
    // When silent, hide prior speech so old text does not persist after silence ends.
    if (currentSpeech !== '') {
      setSpeech('');
    }
    return;
  }

  if (res.speech !== undefined) {
    const newSpeech = normalizeSpeechText(res.speech) ?? '';
    if (newSpeech !== currentSpeech) {
      setSpeech(newSpeech);
    }
  }
}
