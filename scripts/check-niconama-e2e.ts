#!/usr/bin/env bun

const url = process.argv[2] ?? process.env.NICONAMA_TEST_WATCH_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';

(async () => {
  try {
    const mod = await import('../lib/niconamaCommentClient.ts');
    const { createNiconamaCommentClient } = mod as any;

    const received: any[] = [];
    const client = createNiconamaCommentClient({ watchUrl: url, userDataDir: './tmp/niconama-user-data-e2e' }, {
      onComments: (comments: any) => {
        console.log('[COMMENTS]', JSON.stringify(comments));
        received.push(...comments);
      },
      onMeta: (meta: any) => {
        console.log('[META]', JSON.stringify(meta));
      },
      onError: (err: unknown) => {
        console.error('[ERROR]', err);
      },
    });

    await client.start();
    console.log('Client started; waiting up to 45s for comments...');

    const ok = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 45_000);
      const interval = setInterval(() => {
        if (received.length > 0) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(true);
        }
      }, 250);
    });

    await client.stop();
    try { Bun.spawnSync(["rm", "-rf", "./tmp/niconama-user-data-e2e"]); } catch {}

    if (ok) {
      console.log('SUCCESS: received comments');
      process.exit(0);
    }

    console.error('FAIL: no comments received within timeout');
    process.exit(2);
  } catch (err) {
    console.error('Script failed:', err);
    process.exit(3);
  }
})();
