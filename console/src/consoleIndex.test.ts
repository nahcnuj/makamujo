import { describe, expect, it } from 'bun:test';
import { createAccessDeniedRedirectResponse, createLoopbackProxyHeaders, isConsoleIPRestrictionEnabled } from '../../console/index.ts';

describe('createAccessDeniedRedirectResponse', () => {
  it('redirects /console/ requests to the external console redirect URL', () => {
    const url = new URL('https://example.com/console/hello');
    const response = createAccessDeniedRedirectResponse(url);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://live.nicovideo.jp/watch/user/14171889');
  });

  it('redirects non-console requests to /console/ with status 308', () => {
    const url = new URL('https://example.com/foo/bar');
    const response = createAccessDeniedRedirectResponse(url);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/console/');
  });
});

describe('createLoopbackProxyHeaders', () => {
  it('removes hop-by-hop and origin-specific headers', () => {
    const original = new Headers({
      connection: 'keep-alive, Upgrade',
      host: 'evil.example.com',
      origin: 'https://evil.example.com',
      referer: 'https://evil.example.com',
      'proxy-authorization': 'secret',
      'keep-alive': 'timeout=5',
      'upgrade': 'websocket',
      'sec-websocket-protocol': 'foo',
      'content-type': 'application/json',
    });

    const headers = createLoopbackProxyHeaders(original);
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('host')).toBeNull();
    expect(headers.get('origin')).toBeNull();
    expect(headers.get('referer')).toBeNull();
    expect(headers.get('proxy-authorization')).toBeNull();
    expect(headers.get('keep-alive')).toBeNull();
    expect(headers.get('upgrade')).toBeNull();
    expect(headers.get('sec-websocket-protocol')).toBe('foo');
    expect(headers.get('content-type')).toBe('application/json');
  });
});

describe('isConsoleIPRestrictionEnabled', () => {
  it('returns true only in production', () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(isConsoleIPRestrictionEnabled()).toBe(true);
      process.env.NODE_ENV = 'development';
      expect(isConsoleIPRestrictionEnabled()).toBe(false);
      delete process.env.NODE_ENV;
      expect(isConsoleIPRestrictionEnabled()).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = original;
      }
    }
  });
});
