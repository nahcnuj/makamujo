/**
 * Base URL of the broadcasting app API that serves `/api/meta`.
 * Override with `BROADCASTING_AGENT_API_BASE_URL` when the console and
 * broadcasting app are not co-located in the same runtime.
 */
const BROADCASTING_AGENT_BASE_URL = process.env.BROADCASTING_AGENT_API_BASE_URL ?? "http://127.0.0.1:7777";

export async function GET() {
  try {
    const response = await fetch(new URL("/api/meta", BROADCASTING_AGENT_BASE_URL));
    if (!response.ok) {
      return Response.json(
        { error: `failed to fetch /api/meta: ${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }
    return Response.json(await response.json());
  } catch (error) {
    return Response.json(
      { error: `failed to fetch /api/meta: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
