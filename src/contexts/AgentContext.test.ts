import { describe, expect, it } from "bun:test";
import { applyResponse } from "./speechState";

describe('applyResponse', () => {
  describe('silent', () => {
    it('is false by default when response has no silent field', () => {
      const { silent } = applyResponse({}, '');
      expect(silent).toBe(false);
    });

    it('is false when API returns silent:false', () => {
      const { silent } = applyResponse({ silent: false }, '');
      expect(silent).toBe(false);
    });

    it('is true when API returns silent:true', () => {
      const { silent } = applyResponse({ silent: true }, '');
      expect(silent).toBe(true);
    });

    it('switches from true to false when silent flag clears', () => {
      const a = applyResponse({ silent: true }, '');
      expect(a.silent).toBe(true);
      const b = applyResponse({ silent: false }, a.speech);
      expect(b.silent).toBe(false);
    });
  });

  describe('speech', () => {
    it('is updated when API returns a non-empty string', () => {
      const { speech } = applyResponse({ speech: 'hello' }, '');
      expect(speech).toBe('hello');
    });

    it('retains current speech when API returns an empty string', () => {
      const { speech } = applyResponse({ speech: '' }, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when API response has no speech field', () => {
      const { speech } = applyResponse({}, 'old text');
      expect(speech).toBe('old text');
    });

    it('retains current speech when agent is silent', () => {
      const { speech, silent } = applyResponse({ speech: '', silent: true }, 'last spoken');
      expect(silent).toBe(true);
      expect(speech).toBe('last spoken');
    });

    it('updates speech and clears silent together', () => {
      const { speech, silent } = applyResponse({ speech: 'new line', silent: false }, 'last spoken');
      expect(speech).toBe('new line');
      expect(silent).toBe(false);
    });
  });
});
