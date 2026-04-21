/**
 * Shared fixture for mocked `/console/api/agent-state` responses used by UI tests.
 * Keep this payload deterministic so screenshot and integration assertions stay stable.
 */
export const AGENT_STATE_RESPONSE_MOCK_FIXTURE = {
  niconama: {
    type: "live",
    meta: {
      title: "配信エージェント状態モック",
      url: "https://example.com/watch/mock",
      start: 1_717_000_000,
      total: {
        listeners: 123,
        gift: 456,
        ad: 789,
      },
    },
  },
  canSpeak: true,
  currentGame: {
    name: "org.dashnet.orteil/cookieclicker",
    state: {
      status: "idle",
    },
  },
  nGram: 4,
  nGramRaw: 4,
  speech: {
    speech: "コメントを学習してお話ししています",
    silent: false,
  },
  speechHistory: [
    { id: "speech-history-1", speech: "コメントを学習してお話ししています", nGram: 4, nGramRaw: 4 },
    { id: "speech-history-2", speech: "ぜひ上のリンクから遊びに来てね", nGram: 3, nGramRaw: 3.2 },
  ],
} as const;

export const cloneAgentStateResponseMockFixture = () => ({
  niconama: {
    type: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.type,
    meta: {
      title: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.title,
      url: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.url,
      start: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.start,
      total: {
        listeners: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.total.listeners,
        gift: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.total.gift,
        ad: AGENT_STATE_RESPONSE_MOCK_FIXTURE.niconama.meta.total.ad,
      },
    },
  },
  canSpeak: AGENT_STATE_RESPONSE_MOCK_FIXTURE.canSpeak,
  currentGame: {
    name: AGENT_STATE_RESPONSE_MOCK_FIXTURE.currentGame.name,
    state: {
      ...AGENT_STATE_RESPONSE_MOCK_FIXTURE.currentGame.state,
    },
  },
  nGram: AGENT_STATE_RESPONSE_MOCK_FIXTURE.nGram,
  nGramRaw: AGENT_STATE_RESPONSE_MOCK_FIXTURE.nGramRaw,
  speech: {
    ...AGENT_STATE_RESPONSE_MOCK_FIXTURE.speech,
  },
  speechHistory: AGENT_STATE_RESPONSE_MOCK_FIXTURE.speechHistory.map((historyItem) => ({ ...historyItem })),
});
