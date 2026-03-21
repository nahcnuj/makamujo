/**
 * Update `speech` and `silent` state from a `/api/speech` response.
 * `speech` is only replaced when the response contains a non-empty string, so
 * the display never goes blank between speech generations.
 */
export function updateSpeechState(
  res: { speech?: string; silent?: boolean },
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

  const newSpeech = res.speech ? res.speech : currentSpeech;
  if (newSpeech !== currentSpeech) {
    setSpeech(newSpeech);
  }
}
