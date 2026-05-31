import { createNiconamaCommentClient } from "../lib/niconamaCommentClient";

const WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL ?? "https://live.nicovideo.jp/watch/user/14171889";

async function main() {
  const collected: any[] = [];
  const userDataDir = process.env.NICONAMA_USER_DATA_DIR ?? './tmp/niconama-user-data';
  const client = createNiconamaCommentClient({ watchUrl: WATCH_URL, userDataDir }, {
    onComments: (comments) => { collected.push(...comments); },
    onMeta: () => {},
    onError: (err) => { console.error('client error', err); },
  });

  console.log('Starting client for', WATCH_URL);
  await client.start();

  // Wait up to 60s for comments to arrive (or shorter if already present)
  // Some streams only provide a commentCount in embedded data and then
  // deliver bodies over WebSocket; allow longer wait and prefer real
  // comment bodies over the synthetic '(コメントあり)' placeholder.
  const waitMs = 60_000;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    // stop early if we received any real comment bodies
    if (collected.some((c) => {
      const data = c?.data ?? c;
      const text = String(data?.comment ?? data?.text ?? '');
      return text.length > 0 && text !== '(コメントあり)';
    })) break;
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
    const text = String(data?.comment ?? data?.text ?? '');
    // ignore the synthetic placeholder
    if (text === '(コメントあり)') continue;
    const key = `${data?.no ?? 'none'}|${data?.userId ?? 'unknown'}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(data);
  }

  // If we still have no real comments, attempt a Playwright-rendered
  // HTML fetch and re-parse embedded data from the rendered body.
  if (unique.length === 0) {
    try {
      const rendered = await client.fetchRenderedWatchPageBodyText(WATCH_URL);
      if (rendered) {
        const { extractEmbeddedDataFromHtml, parseAgentCommentsFromResponseBody } = await import('../lib/niconamaCommentClient');
        const embeddedFromRendered = extractEmbeddedDataFromHtml(rendered);
        if (embeddedFromRendered) {
          const renderedComments = parseAgentCommentsFromResponseBody(embeddedFromRendered);
          for (const c of renderedComments) collected.push(c);
        }
      }
    } catch (e) {
      /* ignore */
    }

    // rebuild unique after rendered attempt
    seen.clear();
    unique.length = 0;
    for (const item of collected) {
      const data = item?.data ?? item;
      const text = String(data?.comment ?? data?.text ?? '');
      if (text === '(コメントあり)') continue;
      const key = `${data?.no ?? 'none'}|${data?.userId ?? 'unknown'}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(data);
    }
  }

  // If still no real comments, wait a bit longer while keeping the
  // direct websocket open to allow live frames to arrive.
  if (unique.length === 0) {
    console.log('No comment bodies found yet — waiting 60s for live frames...');
    const extraWaitStart = Date.now();
    const extraWaitMs = 60_000;
    while (Date.now() - extraWaitStart < extraWaitMs) {
      if (collected.some((c) => {
        const data = c?.data ?? c;
        const text = String(data?.comment ?? data?.text ?? '');
        return text.length > 0 && text !== '(コメントあり)';
      })) break;
      // poll every 1s
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // rebuild unique again
    seen.clear();
    unique.length = 0;
    for (const item of collected) {
      const data = item?.data ?? item;
      const text = String(data?.comment ?? data?.text ?? '');
      if (text === '(コメントあり)') continue;
      const key = `${data?.no ?? 'none'}|${data?.userId ?? 'unknown'}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(data);
    }
  }

  // Final attempt: if we still only have the synthetic placeholder,
  // run the Playwright capture script briefly and parse logs for
  // comment-like JSON payloads. If we find real bodies, prefer them.
  if (unique.length === 0) {
    try {
      console.log('Running Playwright capture fallback (30s)...');
      const { execSync } = await import('node:child_process');
      // run the dedicated capture script which writes to /tmp/playwright-*.log
      try {
        execSync('bun ./scripts/playwright-capture.ts', { cwd: process.cwd(), stdio: 'inherit', timeout: 35_000 });
      } catch (e) {
        // capture may still have written logs; continue
      }

      const { readFileSync } = await import('node:fs');
      const { parseAgentCommentsFromResponseBody } = await import('../lib/niconamaCommentClient');
      const candidateComments: any[] = [];

      const tryParseFromLog = (path: string) => {
        try {
          const txt = readFileSync(path, 'utf8');
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

      tryParseFromLog('/tmp/playwright-ws.log');
      tryParseFromLog('/tmp/playwright-net.log');

      // If we found real comments, add them to collected and rebuild unique
      if (candidateComments.length > 0) {
        for (const c of candidateComments) collected.push(c);
        seen.clear();
        unique.length = 0;
        for (const item of collected) {
          const data = item?.data ?? item;
          const text = String(data?.comment ?? data?.text ?? '');
          if (text === '(コメントあり)') continue;
          const key = `${data?.no ?? 'none'}|${data?.userId ?? 'unknown'}|${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(data);
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  console.log(`Collected ${unique.length} unique comments:`);
  for (const c of unique) {
    console.log('-', c);
  }

  await client.stop();
  try { /* cleanup tmp dir if desired */ } catch {}
}

main().catch((err) => { console.error(err); process.exit(1); });
