import { describe, expect, it, mock } from "bun:test";
import { updateSpeechState } from "./speechState";
import { applySpeechApiResponse, applyMetaApiResponse } from "./AgentContext";
import type { AgentState } from "../../lib/Agent/State";

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

describe('applySpeechApiResponse', () => {
  it('does not update state when res is null (fetch error)', () => {
    const setSpeech = mock((_: string) => {});
    const setSilent = mock((_: boolean) => {});
    applySpeechApiResponse(null, 'currently displayed text', setSpeech, setSilent);
    expect(setSpeech).not.toHaveBeenCalled();
    expect(setSilent).not.toHaveBeenCalled();
  });

  it('updates speech state when res is a valid response', () => {
    const setSpeech = mock((_: string) => {});
    const setSilent = mock((_: boolean) => {});
    applySpeechApiResponse({ speech: 'new speech', silent: false }, '', setSpeech, setSilent);
    expect(setSpeech).toHaveBeenCalledWith('new speech');
    expect(setSilent).toHaveBeenCalledWith(false);
  });
});

describe('applyMetaApiResponse', () => {
  it('does not update state when res is null (fetch error)', () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    applyMetaApiResponse(null, setStreamState);
    expect(setStreamState).not.toHaveBeenCalled();
  });

  it('updates stream state when res contains niconama', () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    const niconama: AgentState = { type: 'live', meta: { title: 'test', url: 'https://example.com', start: 0 } };
    applyMetaApiResponse({ niconama }, setStreamState);
    expect(setStreamState).toHaveBeenCalledWith(niconama);
  });

  it('updates stream state to undefined when niconama is absent in res', () => {
    const setStreamState = mock((_: AgentState | undefined) => {});
    applyMetaApiResponse({}, setStreamState);
    expect(setStreamState).toHaveBeenCalledWith(undefined);
  });
});
