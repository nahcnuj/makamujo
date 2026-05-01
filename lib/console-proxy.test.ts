import { test, expect } from 'bun:test';
import { createResilientSseProxy } from './console-proxy';

test('createResilientSseProxy sends keepalive comments for idle SSE streams', async () => {
  const firstResponse = new Response(new ReadableStream<Uint8Array>({
    start() {
      // Keep the first upstream stream open without sending any data.
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });

  const proxyResponse = createResilientSseProxy(
    firstResponse,
    async () => {
      return new Response(new ReadableStream<Uint8Array>({
        start() {
          // Keep the reconnect stream open as well.
        },
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    },
    50,
    20,
  );

  const reader = proxyResponse.body!.getReader();
  const decoder = new TextDecoder();

  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for keepalive')), 500)),
  ]);

  expect(result.done).toBe(false);
  expect(decoder.decode(result.value)).toContain(': keepalive');

  await reader.cancel();
});
