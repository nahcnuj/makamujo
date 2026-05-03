export type SpeechHistoryEntry = {
  id: string;
  speech: string;
  nGram?: number;
  nGramRaw?: number;
  nodes?: string[];
};

let speechHistoryRef: SpeechHistoryEntry[] = [];

/**
 * Bind the in-memory speech history array from the server.
 * Pass the array by reference so the handler always reads the current contents.
 */
export const setSpeechHistoryRef = (ref: SpeechHistoryEntry[]): void => {
  speechHistoryRef = ref;
};

export const GET = (req: Request): Response => {
  const url = new URL(req.url);
  const beforeId = url.searchParams.get('before');
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(1, Number.parseInt(limitParam ?? '10', 10) || 10), 50);

  let startIndex = 0;
  if (beforeId !== null) {
    const beforeIndex = speechHistoryRef.findIndex((item) => item.id === beforeId);
    if (beforeIndex === -1) {
      return Response.json({ items: [], hasMore: false });
    }
    startIndex = beforeIndex + 1;
  }

  const items = speechHistoryRef.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < speechHistoryRef.length;
  return Response.json({ items, hasMore });
};
