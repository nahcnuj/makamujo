import { createNiconamaCommentClient } from "../lib/niconamaCommentClient";

const WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL ?? "https://live.nicovideo.jp/watch/user/14171889";

async function main() {
  const collected: any[] = [];
  const client = createNiconamaCommentClient({ watchUrl: WATCH_URL, userDataDir: './tmp/niconama-user-data' }, {
    onComments: (comments) => { collected.push(...comments); },
    onMeta: () => {},
    onError: (err) => { console.error('client error', err); },
  });

  console.log('Starting client for', WATCH_URL);
  await client.start();

  // Wait up to 12s for comments to arrive (or shorter if already present)
  const waitMs = 12_000;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    if (collected.length > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Also fetch embedded data once and include parsed embedded comments
  try {
    const embedded = await client.fetchEmbeddedData();
    if (embedded) {
      const { parseAgentCommentsFromResponseBody } = await import('../lib/niconamaCommentClient');
      const embeddedComments = parseAgentCommentsFromResponseBody(embedded);
      for (const c of embeddedComments) collected.push(c);
    }
  } catch (e) { /* ignore */ }

  // Deduplicate by text+no+userId
  const seen = new Set<string>();
  const unique = [] as any[];
  for (const item of collected) {
    const data = item?.data ?? item;
    const key = `${data?.no ?? 'none'}|${data?.userId ?? 'unknown'}|${String(data?.comment ?? data?.text ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(data);
  }

  console.log(`Collected ${unique.length} unique comments:`);
  for (const c of unique) {
    console.log('-', c);
  }

  await client.stop();
  try { /* cleanup tmp dir if desired */ } catch {}
}

main().catch((err) => { console.error(err); process.exit(1); });
