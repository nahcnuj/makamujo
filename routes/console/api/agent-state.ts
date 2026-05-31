/**
 * Base URL of the broadcasting app API that serves `/api/meta`.
 * Override with `BROADCASTING_AGENT_API_BASE_URL` when the console and
 * broadcasting app are not co-located in the same runtime.
 */
const AGENT_STATE_TIMEOUT_MS = 5_000;
const AGENT_STATE_TIMEOUT_ERROR_MESSAGE = `failed to fetch /api/meta: request timed out (${AGENT_STATE_TIMEOUT_MS}ms)`;

const getBroadcastingAgentBaseUrl = (req?: Request): string => {
  if (process.env.BROADCASTING_AGENT_API_BASE_URL) {
    return process.env.BROADCASTING_AGENT_API_BASE_URL;
  }
  if (req) {
    return new URL("/api/meta", req.url).origin;
  }
  return "http://127.0.0.1:7777";
};

export async function GET(req?: Request) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, AGENT_STATE_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/api/meta", getBroadcastingAgentBaseUrl(req)), {
      signal: abortController.signal,
    });
    if (!response.ok) {
      return Response.json(
        { error: `failed to fetch /api/meta: ${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }
    return Response.json(await response.json());
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json({ error: AGENT_STATE_TIMEOUT_ERROR_MESSAGE }, { status: 502 });
    }
    return Response.json(
      { error: `failed to fetch /api/meta: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
