import { describe, expect, it } from 'bun:test';
import { normalizePublishedStreamState, normalizeSpeechText } from '../src/lib/streamState';

describe('normalizePublishedStreamState', () => {
  it('normalizes legacy niconama payload to niconama meta format', () => {
    const result = normalizePublishedStreamState({
      type: 'niconama',
      data: {
        isLive: true,
        title: 'test stream',
        url: 'https://example.com',
        startTime: '2025-05-06T00:00:00Z',
        total: 123,
        points: { gift: 10, ad: 2 },
      },
    });

    expect(result).toEqual({
      niconama: {
        type: 'live',
        meta: {
          title: 'test stream',
          url: 'https://example.com',
          start: '2025-05-06T00:00:00Z',
          total: { listeners: 123, gift: 10, ad: 2 },
        },
      },
    });
  });

  it('returns unchanged object when niconama is already normalized', () => {
    const input = { niconama: { type: 'offline' } };
    expect(normalizePublishedStreamState(input)).toBe(input);
  });

  it('wraps legacy live/offline state in niconama', () => {
    expect(normalizePublishedStreamState({ type: 'live', foo: 'bar' })).toEqual({
      niconama: { type: 'live', foo: 'bar' },
    });

    expect(normalizePublishedStreamState({ type: 'offline' })).toEqual({
      niconama: { type: 'offline' },
    });
  });

  it('returns non-object values untouched', () => {
    expect(normalizePublishedStreamState(null)).toBeNull();
    expect(normalizePublishedStreamState('test')).toBe('test');
    expect(normalizePublishedStreamState(42)).toBe(42);
  });
});

describe('normalizeSpeechText', () => {
  it('returns plain strings as-is', () => {
    expect(normalizeSpeechText('hello')).toBe('hello');
  });

  it('returns text field when present', () => {
    expect(normalizeSpeechText({ text: 'こんにちは' })).toBe('こんにちは');
  });

  it('returns speech field when present', () => {
    expect(normalizeSpeechText({ speech: 'hello' })).toBe('hello');
  });

  it('returns nested speech.text values', () => {
    expect(normalizeSpeechText({ speech: { text: ' nested ' } })).toBe('nested');
  });

  it('prefers text over speech when both exist', () => {
    expect(normalizeSpeechText({ text: 'text', speech: 'speech' })).toBe('text');
  });

  it('returns undefined for unsupported values', () => {
    expect(normalizeSpeechText(undefined)).toBeUndefined();
    expect(normalizeSpeechText({})).toBeUndefined();
    expect(normalizeSpeechText({ text: 1 })).toBeUndefined();
  });
});
