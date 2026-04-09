import { describe, expect, it } from "bun:test";
import { createPopupPageHandler, createRedirectToHomeHandler } from "./chromium";

const HOME_URL = 'https://orteil.dashnet.org/cookieclicker/';

describe('createPopupPageHandler', () => {
  const makePageLike = (url: string) => {
    let closed = false;
    return {
      url: () => url,
      close: async () => { closed = true; },
      get closed() { return closed; },
    };
  };

  it('should close a new tab that is not the main page', async () => {
    const mainPage = makePageLike(HOME_URL);
    const popupPage = makePageLike('https://example.com/ad');
    const handler = createPopupPageHandler(mainPage);

    await handler(popupPage);

    expect(popupPage.closed).toBeTrue();
  });

  it('should not close the main page itself', async () => {
    const mainPage = makePageLike(HOME_URL);
    const handler = createPopupPageHandler(mainPage);

    await handler(mainPage);

    expect(mainPage.closed).toBeFalse();
  });
});

describe('createRedirectToHomeHandler', () => {
  const makeFrameLike = (url: string) => ({ url: () => url });

  it('should redirect when the main frame navigates away from home', async () => {
    const mainFrame = makeFrameLike('https://example.com/ad');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(mainFrame);

    await Promise.resolve(); // flush microtasks
    expect(redirectedUrls).toEqual([HOME_URL]);
  });

  it('should not redirect when already at the home URL', () => {
    const mainFrame = makeFrameLike(HOME_URL);
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(mainFrame);

    expect(redirectedUrls).toBeEmpty();
  });

  it('should not redirect when already at a sub-path of the home URL', () => {
    const mainFrame = makeFrameLike(HOME_URL + '?some=param');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(mainFrame);

    expect(redirectedUrls).toBeEmpty();
  });

  it('should not redirect for about:blank', () => {
    const mainFrame = makeFrameLike('about:blank');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(mainFrame);

    expect(redirectedUrls).toBeEmpty();
  });

  it('should not redirect when a sub-frame navigates away', () => {
    const mainFrame = makeFrameLike(HOME_URL);
    const subFrame = makeFrameLike('https://example.com/ad');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(subFrame);

    expect(redirectedUrls).toBeEmpty();
  });

  it('should not trigger a second redirect while one is already in progress', async () => {
    let resolveFirst!: () => void;
    const firstRedirectDone = new Promise<void>((resolve) => { resolveFirst = resolve; });

    const mainFrame = makeFrameLike('https://example.com/ad');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => {
        redirectedUrls.push(url);
        await firstRedirectDone;
      },
    );

    handler(mainFrame); // first call starts the redirect
    handler(mainFrame); // second call should be ignored

    resolveFirst();
    await Promise.resolve();

    expect(redirectedUrls).toHaveLength(1);
  });

  it('should allow a redirect again after a failed redirect', async () => {
    const mainFrame = makeFrameLike('https://example.com/');
    let callCount = 0;
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async () => {
        callCount++;
        throw new Error('navigation failed');
      },
    );

    handler(mainFrame);
    await Promise.resolve(); // start first redirect
    await Promise.resolve(); // allow catch handler to reset the flag

    handler(mainFrame); // should be allowed since the first one failed
    await Promise.resolve();

    expect(callCount).toBe(2);
  });

  it('should reset the redirecting flag when the main frame reaches home', () => {
    const mainFrame = makeFrameLike('https://example.com/ad');
    const redirectedUrls: string[] = [];
    const handler = createRedirectToHomeHandler(
      mainFrame,
      HOME_URL,
      async (url) => { redirectedUrls.push(url); },
    );

    handler(mainFrame); // triggers redirect, sets isRedirecting = true

    // Simulate the main frame arriving at the home URL
    const arrivedFrame = makeFrameLike(HOME_URL);
    // We need the handler to compare frame identity to mainFrame, so use mainFrame with a different url() impl
    const arrivedMainFrame = Object.assign(mainFrame, { url: () => HOME_URL });
    handler(arrivedMainFrame); // should reset isRedirecting = false

    // Now another navigation away should trigger a redirect again
    Object.assign(arrivedMainFrame, { url: () => 'https://example.com/ad2' });
    handler(arrivedMainFrame);

    expect(redirectedUrls.length).toBeGreaterThanOrEqual(2);
  });
});
