export const AGENT_STATE_WEB_SOCKET_PATH = "/console/api/ws";
export const AGENT_STATE_WEB_SOCKET_RECONNECT_DELAY_MS = 2_000;

export const createAgentStateWebSocketUrl = (baseHref: `wss:${string}`): string => {
  return new URL(AGENT_STATE_WEB_SOCKET_PATH, baseHref).toString();
};

export type AgentStateResponse = {
  error?: string
  niconama?: {
    type?: string
    meta?: {
      title?: string
      url?: string
      start?: number
      total?: {
        listeners?: number
        gift?: number
        ad?: number
        comments?: number
      }
    }
  }
  canSpeak?: boolean
  currentGame?: {
    name?: string
    state?: Record<string, unknown>
  } | null
  nGram?: number
  nGramRaw?: number
  speech?: {
    speech?: string
    silent?: boolean
  }
  speechHistory?: Array<{
    id?: string
    speech?: string
    nGram?: number
    nGramRaw?: number
  }>
};
const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";

export const parseAgentStateResponse = (responseText: string): AgentStateResponse => {
  try {
    return JSON.parse(responseText) as AgentStateResponse;
  } catch {
    throw new SyntaxError(INVALID_AGENT_STATE_RESPONSE_ERROR);
  }
};

export async function fetchAgentStateFromApi(
  fetchImpl: typeof fetch = fetch,
  url = "/console/api/agent-state",
): Promise<AgentStateResponse> {
  const response = await fetchImpl(url);
  const responseText = await response.text();
  if (!response.ok) {
    let errorMessageFromResponse: string | null = null;
    try {
      const responseData = parseAgentStateResponse(responseText);
      errorMessageFromResponse = responseData.error ?? null;
    } catch {
      errorMessageFromResponse = null;
    }
    throw new Error(errorMessageFromResponse ?? `配信状態の取得に失敗しました (${response.status})`);
  }
  return parseAgentStateResponse(responseText);
}
