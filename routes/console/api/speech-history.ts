/**
 * Base URL of the broadcasting app API that serves `/api/speech-history`.
 * Override with `BROADCASTING_AGENT_API_BASE_URL` when the console and
 * broadcasting app are not co-located in the same runtime.
 */
const BROADCASTING_AGENT_BASE_URL = process.env.BROADCASTING_AGENT_API_BASE_URL ?? "http://127.0.0.1:7777";
const SPEECH_HISTORY_TIMEOUT_MS = 5_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetUrl = new URL("/api/speech-history", BROADCASTING_AGENT_BASE_URL);

  const before = url.searchParams.get("before");
  const limit = url.searchParams.get("limit");
  if (before !== null) targetUrl.searchParams.set("before", before);
  if (limit !== null) targetUrl.searchParams.set("limit", limit);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), SPEECH_HISTORY_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl.toString(), { signal: abortController.signal });
    if (!response.ok) {
      return Response.json(
        { error: `failed to fetch /api/speech-history: ${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }
    return Response.json(await response.json());
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json(
        { error: `failed to fetch /api/speech-history: request timed out (${SPEECH_HISTORY_TIMEOUT_MS}ms)` },
        { status: 502 },
      );
    }
    return Response.json(
      { error: `failed to fetch /api/speech-history: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
