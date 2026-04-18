const broadcastingAgentApiBaseURL = process.env.BROADCASTING_AGENT_API_BASE_URL ?? "http://127.0.0.1:7777";

export async function GET() {
  try {
    const response = await fetch(new URL("/api/meta", broadcastingAgentApiBaseURL));
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
