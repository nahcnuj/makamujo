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
