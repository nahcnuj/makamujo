/**
 * Compute the next `speech` and `silent` values from a `/api/speech` response.
 * `speech` is only replaced when the response contains a non-empty string, so
 * the display never goes blank between speech generations.
 */
export function processSpeechResponse(
  res: { speech?: string; silent?: boolean },
  currentSpeech: string,
): { speech: string; silent: boolean } {
  return {
    speech: res.speech ? res.speech : currentSpeech,
    silent: !!res.silent,
  };
}
