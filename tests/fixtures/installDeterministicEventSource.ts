/**
 * Replaces `window.EventSource` with a deterministic implementation that emits
 * a single SSE payload. Used by browser tests and screenshot capture scripts.
 */
export const installDeterministicEventSource = ({
  responseText,
}: {
  responseText: string;
}) => {
  class DeterministicEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    url: string;
    readyState = DeterministicEventSource.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(url: string | URL) {
      this.url = String(url);
      setTimeout(() => {
        if (this.readyState === DeterministicEventSource.CLOSED) {
          return;
        }
        this.readyState = DeterministicEventSource.OPEN;
        this.onopen?.(new Event("open"));
        this.onmessage?.(new MessageEvent("message", { data: responseText }));
      }, 0);
    }

    close() {
      this.readyState = DeterministicEventSource.CLOSED;
    }
  }

  (
    window as unknown as { EventSource: typeof DeterministicEventSource }
  ).EventSource = DeterministicEventSource;
};
