/**
 * Outer console TLS server WebSocket bridge to the loopback console.
 * Behavior matches the previous inline handler in console/index.ts.
 */

export type OuterConsoleWsData = {
  loopbackWsUrl: string;
  protocols: string[] | undefined;
  target?: WebSocket;
};

/**
 * Bun WebSocketHandler that accepts the client socket and bridges to a loopback WebSocket.
 */
export const createOuterConsoleWebSocketHandler = (): Bun.WebSocketHandler<OuterConsoleWsData> => ({
  open(ws) {
    const { loopbackWsUrl, protocols } = ws.data;
    try {
      const target = new WebSocket(loopbackWsUrl, protocols);

      target.binaryType = "arraybuffer";

      target.onopen = () => {
        // noop
      };

      target.onmessage = (ev) => {
        try { ws.send(ev.data as string | ArrayBuffer); } catch { /* ignore */ }
      };

      target.onclose = () => { try { ws.close(); } catch { /* ignore */ } };
      target.onerror = () => { try { ws.close(); } catch { /* ignore */ } };

      ws.data.target = target;
    } catch {
      try { ws.close(); } catch { /* ignore */ }
    }
  },
  message(ws, data) {
    const { target } = ws.data;
    if (target) try { target.send(data as string | ArrayBuffer); } catch { /* ignore */ }
  },
  close(ws) {
    const { target } = ws.data;
    if (target) try { target.close(); } catch { /* ignore */ }
  },
});
