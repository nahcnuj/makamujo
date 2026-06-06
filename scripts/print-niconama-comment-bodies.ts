import {
  createNiconamaCommentClient,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
} from "../lib/niconamaCommentClient";

const WATCH_URL =
  process.argv[2] ??
  process.env.NICONAMA_WATCH_URL ??
  "https://live.nicovideo.jp/watch/user/14171889";
const USER_DATA_DIR =
  process.env.NICONAMA_USER_DATA_DIR ?? "./tmp/niconama-user-data";
const DURATION_MS = process.env.NICONAMA_PRINT_DURATION_MS
  ? Number(process.env.NICONAMA_PRINT_DURATION_MS)
  : undefined;

const printed = new Set<string>();

function extractCommentText(item: unknown): string | null {
  return getCommentTextFromAgentComment(item);
}

function buildCommentKey(item: unknown, text: string): string {
  const value =
    item && typeof item === "object" ? ((item as any).data ?? item) : item;
  const no = value?.no ?? "none";
  const userId = value?.userId ?? value?.user_id ?? "unknown";
  return `${text}|${no}|${userId}`;
}

async function main() {
  console.log(`Watching: ${WATCH_URL}`);
  const client = createNiconamaCommentClient(
    { watchUrl: WATCH_URL, userDataDir: USER_DATA_DIR },
    {
      onComments: (comments) => {
        for (const comment of comments) {
          const text = extractCommentText(comment);
          if (!text) continue;
          const key = buildCommentKey(comment, text);
          if (printed.has(key)) continue;
          printed.add(key);
          console.log(text);
        }
      },
      onMeta: () => {},
      onError: (err) => {
        console.error("NiconamaCommentClient error:", err);
      },
    },
  );

  await client.start();

  try {
    const renderedComments = await client
      .fetchRenderedPageComments(WATCH_URL)
      .catch(() => [] as any[]);
    for (const comment of filterAgentCommentsWithText(renderedComments)) {
      const text = extractCommentText(comment);
      if (!text) continue;
      const key = buildCommentKey(comment, text);
      if (printed.has(key)) continue;
      printed.add(key);
      console.log(text);
    }
  } catch (e) {
    // ignore fallback extraction failures
  }

  if (typeof DURATION_MS === "number" && !Number.isNaN(DURATION_MS)) {
    setTimeout(async () => {
      console.error(`Stopping after ${DURATION_MS}ms`);
      await client.stop();
      process.exit(0);
    }, DURATION_MS);
  }

  process.on("SIGINT", async () => {
    console.error("Interrupted, stopping client...");
    await client.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
