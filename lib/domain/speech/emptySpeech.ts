/**
 * Whether TTS should be invoked for a speech text.
 * Empty / whitespace-only text skips TTS but listeners still run (legacy).
 */
export const shouldInvokeTts = (text: string): boolean => text.trim().length > 0;

export const trimmedSpeechText = (text: string): string => text.trim();
