/**
 * Compute the next `speech` and `silent` values from a `/api/speech` response.
 * `speech` is only replaced when the response contains a non-empty string, so
 * the display never goes blank between speech generations.
 */
export function applyResponse(
  response: { speech?: string; silent?: boolean },
  currentSpeech: string,
): { speech: string; silent: boolean } {
  return {
    speech: response.speech ? response.speech : currentSpeech,
    silent: !!response.silent,
  };
}
