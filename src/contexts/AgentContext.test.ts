import { describe, expect, it } from "bun:test";
import { processSpeechResponse } from "./speechState";

describe('processSpeechResponse', () => {
  describe('silent', () => {
    it('is false by default when response has no silent field', () => {
      const { silent } = processSpeechResponse({}, '');
      expect(silent).toBe(false);
    });

    it('is false when API returns silent:false', () => {
      const { silent } = processSpeechResponse({ silent: false }, '');
      expect(silent).toBe(false);
    });

    it('is true when API returns silent:true', () => {
      const { silent } = processSpeechResponse({ silent: true }, '');
      expect(silent).toBe(true);
    });

    it('switches from true to false when silent flag clears', () => {
      const a = processSpeechResponse({ silent: true }, '');
      expect(a.silent).toBe(true);
      const b = processSpeechResponse({ silent: false }, a.speech);
      expect(b.silent).toBe(false);
    });
  });

  describe('speech', () => {
    it('is updated when API returns a non-empty string', () => {
      const { speech } = processSpeechResponse({ speech: 'hello' }, '');
      expect(speech).toBe('hello');
    });

    it('retains current speech when API returns an empty string', () => {
      const { speech } = processSpeechResponse({ speech: '' }, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when API response has no speech field', () => {
      const { speech } = processSpeechResponse({}, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when agent is silent', () => {
      const { speech, silent } = processSpeechResponse({ speech: '', silent: true }, 'last spoken');
      expect(silent).toBe(true);
      expect(speech).toBe('last spoken');
    });

    it('updates speech and clears silent together', () => {
      const { speech, silent } = processSpeechResponse({ speech: 'new line', silent: false }, 'last spoken');
      expect(speech).toBe('new line');
      expect(silent).toBe(false);
    });
  });
});
