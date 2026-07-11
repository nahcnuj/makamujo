import type { AgentComment } from "automated-gameplay-transmitter";
import {
  createNiconamaCommentClient,
  filterAgentCommentsWithText,
  getCommentTextFromAgentComment,
} from "../lib/niconamaCommentClient";

const WATCH_URL =
  process.env.NICONAMA_TEST_WATCH_URL ??
  "https://live.nicovideo.jp/watch/user/14171889";

const isSuspectedMetadataComment = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized === "コメントするにはログインしてください" ||
    normalized === "(コメントあり)" ||
    /^[0-9]+$/.test(normalized) ||
    /^\d+コメント(?:\s*コメントするにはログインしてください)?$/.test(
      normalized,
    ) ||
    /ログインしてください$/u.test(normalized)
  );
};

const buildUniqueComments = (comments: unknown[]): unknown[] => {
  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const item of comments) {
    const text = getCommentTextFromAgentComment(item);
    if (!text) continue;
    const value =
      item && typeof item === "object"
        ? ((item as Record<string, unknown>).data ?? item)
        : item;
    const valueRecord = value as Record<string, unknown>;
    const key = `${valueRecord?.no ?? "none"}|${valueRecord?.userId ?? valueRecord?.user_id ?? "unknown"}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
};

async function main() {
  const collected: unknown[] = [];
  const userDataDir =
    process.env.NICONAMA_USER_DATA_DIR ?? "./tmp/niconama-user-data";
  const client = createNiconamaCommentClient(
    { watchUrl: WATCH_URL, userDataDir },
    {
      onComments: (comments) => {
        collected.push(...comments);
      },
      onMeta: () => {},
      onError: (err) => {
        console.error("client error", err);
      },
    },
  );

  console.log("Starting client for", WATCH_URL);
  await client.start();

  // Wait up to 60s for comments to arrive (or shorter if already present)
  // Some streams only provide a commentCount in embedded data and then
  // deliver bodies over WebSocket; allow longer wait and prefer real
  // comment bodies over the synthetic '(コメントあり)' placeholder.
  const waitMs = 60_000;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    // stop early if we received any real comment bodies
    if (
      collected.some((c) => {
        const text = getCommentTextFromAgentComment(c);
        return text !== null && !isSuspectedMetadataComment(text);
      })
    )
      break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Also fetch embedded data once and include parsed embedded comments
  try {
    const embedded = await client.fetchEmbeddedData();
    if (embedded) {
      const { parseAgentCommentsFromResponseBody } = await import(
        "../lib/niconamaCommentClient"
      );
      const embeddedComments = parseAgentCommentsFromResponseBody(embedded);
      for (const c of embeddedComments) collected.push(c);
    }
  } catch {
    /* ignore */
  }

  const filtered = filterAgentCommentsWithText(
    collected as unknown as AgentComment[],
  );
  const unique = buildUniqueComments(filtered);
  let hasRealComments = unique.some((item) => {
    const text = getCommentTextFromAgentComment(item);
    return text !== null && !isSuspectedMetadataComment(text);
  });

  // If we still have no real comments, attempt a Playwright-rendered
  // HTML fetch and re-parse embedded data from the rendered body.
  if (!hasRealComments) {
    try {
      const rendered = await client.fetchRenderedWatchPageBodyText(WATCH_URL);
      if (rendered) {
        const {
          extractEmbeddedDataFromHtml,
          parseAgentCommentsFromResponseBody,
        } = await import("../lib/niconamaCommentClient");
        const embeddedFromRendered = extractEmbeddedDataFromHtml(rendered);
        if (embeddedFromRendered) {
          const renderedComments =
            parseAgentCommentsFromResponseBody(embeddedFromRendered);
          for (const c of renderedComments) collected.push(c);
        }
      }
    } catch {
      /* ignore */
    }

    const filteredAgain = filterAgentCommentsWithText(
      collected as unknown as AgentComment[],
    );
    unique.length = 0;
    unique.push(...buildUniqueComments(filteredAgain));
  }

  // If still no real comments, wait a bit longer while keeping the
  // direct websocket open to allow live frames to arrive.
  if (!hasRealComments) {
    console.log("No comment bodies found yet — waiting 60s for live frames...");
    const extraWaitStart = Date.now();
    const extraWaitMs = 60_000;
    while (Date.now() - extraWaitStart < extraWaitMs) {
      if (
        collected.some((c) => {
          const text = getCommentTextFromAgentComment(c);
          return text !== null && !isSuspectedMetadataComment(text);
        })
      )
        break;
      // poll every 1s
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const filteredAgain = filterAgentCommentsWithText(
      collected as unknown as AgentComment[],
    );
    unique.length = 0;
    unique.push(...buildUniqueComments(filteredAgain));
    hasRealComments = unique.some((item) => {
      const text = getCommentTextFromAgentComment(item);
      return text !== null && !isSuspectedMetadataComment(text);
    });
  }

  // If still empty, attempt extracting rendered page comments via Playwright
  if (!hasRealComments) {
    console.log(
      "No comments yet — polling rendered extraction for up to 5 minutes...",
    );
    const maxMs = Number(process.env.LIST_DURATION_MS ?? 300_000);
    const intervalMs = Number(process.env.LIST_INTERVAL_MS ?? 5_000);
    const loopStart = Date.now();
    while (Date.now() - loopStart < maxMs) {
      try {
        const renderedComments =
          await client.fetchRenderedPageComments(WATCH_URL);
        if (Array.isArray(renderedComments) && renderedComments.length > 0) {
          for (const c of renderedComments) collected.push(c);
        }
        const embedded = await client.fetchEmbeddedData().catch(() => null);
        if (embedded) {
          const { parseAgentCommentsFromResponseBody } = await import(
            "../lib/niconamaCommentClient"
          );
          const embeddedComments = parseAgentCommentsFromResponseBody(embedded);
          for (const c of embeddedComments) collected.push(c);
        }
      } catch {
        // ignore per-iteration errors
      }

      const filteredAgain = filterAgentCommentsWithText(
        collected as unknown as AgentComment[],
      );
      unique.length = 0;
      unique.push(...buildUniqueComments(filteredAgain));

      if (
        unique.length > 0 &&
        unique.some((item) => {
          const text = getCommentTextFromAgentComment(item);
          return text !== null && !isSuspectedMetadataComment(text);
        })
      )
        break;
      // wait before next attempt
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // Final attempt: if we still only have the synthetic placeholder,
  // run the Playwright capture script briefly and parse logs for
  // comment-like JSON payloads. If we find real bodies, prefer them.
  if (unique.length === 0) {
    try {
      console.log("Running Playwright capture fallback (30s)...");
      const { execSync } = await import("node:child_process");
      // run the dedicated capture script which writes to /tmp/playwright-*.log
      try {
        execSync("bun ./scripts/playwright-capture.ts", {
          cwd: process.cwd(),
          stdio: "inherit",
          timeout: 35_000,
        });
      } catch {
        // capture may still have written logs; continue
      }

      const { readFileSync } = await import("node:fs");
      const { parseAgentCommentsFromResponseBody } = await import(
        "../lib/niconamaCommentClient"
      );
      const candidateComments: unknown[] = [];

      const tryParseFromLog = (path: string) => {
        try {
          const txt = readFileSync(path, "utf8");
          for (const line of txt.split(/\r?\n/)) {
            const m = line.match(/({[\s\S]*})/);
            if (!m) continue;
            // prefer the first capture group if present, fallback to the whole match
            const jsonText = m[1] ?? m[0];
            if (!jsonText) continue;
            try {
              const parsed = JSON.parse(jsonText);
              const parsedComments = parseAgentCommentsFromResponseBody(parsed);
              for (const pc of parsedComments) candidateComments.push(pc);
            } catch {}
          }
        } catch {}
      };

      tryParseFromLog("/tmp/playwright-ws.log");
      tryParseFromLog("/tmp/playwright-net.log");
      // Also inspect the direct WebSocket raw frame log which the client
      // appends to during runtime. This can contain NDJSON snippets and
      // JSON fragments we may have missed earlier.
      tryParseFromLog("/tmp/niconama-ws-raw.log");

      if (candidateComments.length > 0) {
        for (const c of candidateComments) collected.push(c);
        const filteredAgain = filterAgentCommentsWithText(
          collected as unknown as AgentComment[],
        );
        unique.length = 0;
        unique.push(...buildUniqueComments(filteredAgain));
        hasRealComments = unique.some((item) => {
          const text = getCommentTextFromAgentComment(item);
          return text !== null && !isSuspectedMetadataComment(text);
        });
      }
    } catch {
      /* ignore */
    }
  }

  const realUnique = unique.filter((item) => {
    const text = getCommentTextFromAgentComment(item);
    return text !== null && !isSuspectedMetadataComment(text);
  });
  const finalComments = realUnique.length > 0 ? realUnique : unique;

  console.log(`Collected ${finalComments.length} unique comments:`);
  for (const c of finalComments) {
    console.log("-", c);
  }

  await client.stop();
  try {
    /* cleanup tmp dir if desired */
  } catch {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
