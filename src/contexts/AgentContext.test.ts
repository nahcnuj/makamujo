import { describe, expect, it, mock } from "bun:test";
import { updateSpeechState } from "./speechState";

describe('updateSpeechState', () => {
  describe('silent', () => {
    it('calls setSilent(false) when response has no silent field', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({}, '', setSpeech, setSilent);
      expect(setSilent).toHaveBeenCalledWith(false);
    });

    it('calls setSilent(false) when API returns silent:false', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: false }, '', setSpeech, setSilent);
      expect(setSilent).toHaveBeenCalledWith(false);
    });

    it('calls setSilent(true) when API returns silent:true', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: true }, '', setSpeech, setSilent);
      expect(setSilent).toHaveBeenCalledWith(true);
    });

    it('calls setSilent(false) after previously being true', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ silent: true }, '', setSpeech, setSilent);
      expect(setSilent).toHaveBeenLastCalledWith(true);
      updateSpeechState({ silent: false }, '', setSpeech, setSilent);
      expect(setSilent).toHaveBeenLastCalledWith(false);
    });
  });

  describe('speech', () => {
    it('calls setSpeech when API returns a non-empty string', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ speech: 'hello' }, '', setSpeech, setSilent);
      expect(setSpeech).toHaveBeenCalledWith('hello');
    });

    it('clears speech when API returns an empty string', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ speech: '' }, 'old text', setSpeech, setSilent);
      expect(setSpeech).toHaveBeenCalledWith('');
    });

    it('does not call setSpeech when API response has no speech field', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({}, 'old text', setSpeech, setSilent);
      expect(setSpeech).not.toHaveBeenCalled();
    });

    it('resets speech when agent is silent', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ speech: '', silent: true }, 'last spoken', setSpeech, setSilent);
      expect(setSilent).toHaveBeenCalledWith(true);
      expect(setSpeech).toHaveBeenCalledWith('');
    });

    it('calls both setSpeech and setSilent when speech and silent change together', () => {
      const setSpeech = mock((_: string) => {});
      const setSilent = mock((_: boolean) => {});
      updateSpeechState({ speech: 'new line', silent: false }, 'last spoken', setSpeech, setSilent);
      expect(setSpeech).toHaveBeenCalledWith('new line');
      expect(setSilent).toHaveBeenCalledWith(false);
    });
  });
});
