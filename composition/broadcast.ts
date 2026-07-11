/**
 * SSE / WebSocket broadcast helpers extracted from the composition root.
 * Controllers/clients are owned by the host; this module only fans out frames.
 */

export type SseController = ReadableStreamDefaultController<string>;

export const createSseStream = (
  label: string,
  sseClients: Set<SseController>,
  getInitialPayload: () => unknown,
): ReadableStream<string> => {
  let ctl: SseController | undefined;
  return new ReadableStream<string>({
    start(controller) {
      try {
        console.log(`[INFO] SSE client connected (${label})`);
      } catch {
        /* ignore */
      }
      ctl = controller;
      sseClients.add(controller);
      try {
        controller.enqueue(`data: ${JSON.stringify(getInitialPayload())}\n\n`);
      } catch {
        /* ignore */
      }
    },
    cancel() {
      if (ctl) {
        try {
          sseClients.delete(ctl);
        } catch {
          /* ignore */
        }
        ctl = undefined;
      }
    },
  });
};

export const sseBroadcast = (
  sseClients: Set<SseController>,
  payload: unknown,
): void => {
  if (sseClients.size === 0) return;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  try {
    console.log("[INFO] sseBroadcast -> sseClients count=", sseClients.size);
  } catch {
    /* ignore */
  }
  for (const controller of Array.from(sseClients)) {
    try {
      if ((controller.desiredSize ?? 1) <= 0) {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        sseClients.delete(controller);
        continue;
      }
      controller.enqueue(frame);
    } catch {
      try {
        controller.close();
      } catch {
        /* ignore */
      }
      try {
        sseClients.delete(controller);
      } catch {
        /* ignore */
      }
    }
  }
};

export type WsLike = {
  send: (message: string) => void;
  close: () => void;
};

export const broadcastToWsClients = (
  wsClients: Set<WsLike>,
  payload: unknown,
): void => {
  const message = JSON.stringify(payload);
  for (const ws of Array.from(wsClients)) {
    try {
      ws.send(message);
    } catch {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      try {
        wsClients.delete(ws);
      } catch {
        /* ignore */
      }
    }
  }
};

export const broadcastCurrentPayload = (
  context: string,
  getPayload: () => unknown,
  sseClients: Set<SseController>,
  wsClients: Set<WsLike>,
): void => {
  try {
    const payload = getPayload();
    sseBroadcast(sseClients, payload);
    broadcastToWsClients(wsClients, payload);
  } catch (err) {
    console.warn(
      `[WARN] failed to broadcast to clients (${context}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
};
