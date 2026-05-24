#!/usr/bin/env bun

const url = process.argv[2] ?? 'https://live.nicovideo.jp/watch/user/14171889';

(async () => {
  try {
    const mod = await import('../lib/niconamaCommentClient.ts');
    const { createNiconamaCommentClient } = mod as any;

    const client = createNiconamaCommentClient({ watchUrl: url, userDataDir: './tmp/niconama-user-data' }, {
      onComments: (comments: any) => {
        console.log('[COMMENTS]', JSON.stringify(comments, null, 2));
      },
      onMeta: (meta: any) => {
        console.log('[META]', JSON.stringify(meta, null, 2));
      },
      onError: (err: unknown) => {
        console.error('[ERROR]', err);
      },
    });

    await client.start();
    console.log('Client started; running for 20s...');
    await new Promise((res) => setTimeout(res, 20000));
    await client.stop();
    console.log('Client stopped; exiting.');
    process.exit(0);
  } catch (err) {
    console.error('Script failed:', err);
    process.exit(2);
  }
})();
