import { describe, expect, it } from "bun:test";
import { updateSpeechState } from "./speechState";

describe('updateSpeechState', () => {
  describe('silent', () => {
    it('is false by default when response has no silent field', () => {
      const { silent } = updateSpeechState({}, '');
      expect(silent).toBe(false);
    });

    it('is false when API returns silent:false', () => {
      const { silent } = updateSpeechState({ silent: false }, '');
      expect(silent).toBe(false);
    });

    it('is true when API returns silent:true', () => {
      const { silent } = updateSpeechState({ silent: true }, '');
      expect(silent).toBe(true);
    });

    it('switches from true to false when silent flag clears', () => {
      const a = updateSpeechState({ silent: true }, '');
      expect(a.silent).toBe(true);
      const b = updateSpeechState({ silent: false }, a.speech);
      expect(b.silent).toBe(false);
    });
  });

  describe('speech', () => {
    it('is updated when API returns a non-empty string', () => {
      const { speech } = updateSpeechState({ speech: 'hello' }, '');
      expect(speech).toBe('hello');
    });

    it('retains current speech when API returns an empty string', () => {
      const { speech } = updateSpeechState({ speech: '' }, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when API response has no speech field', () => {
      const { speech } = updateSpeechState({}, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when agent is silent', () => {
      const { speech, silent } = updateSpeechState({ speech: '', silent: true }, 'last spoken');
      expect(silent).toBe(true);
      expect(speech).toBe('last spoken');
    });

    it('updates speech and clears silent together', () => {
      const { speech, silent } = updateSpeechState({ speech: 'new line', silent: false }, 'last spoken');
      expect(speech).toBe('new line');
      expect(silent).toBe(false);
    });
  });
});
