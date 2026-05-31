const WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';

async function main(){
  const res = await fetch(WATCH_URL); const html = await res.text();
  const m = /nicoliveProgramId"\s*[:=]\s*"?(lv?\d+)"?/i.exec(html) || /programId"\s*[:=]\s*"?(lv?\d+)"?/i.exec(html);
  const programId = m?.[1] ?? null;
  console.log('found programId:', programId);
  if (!programId) return;
  const numeric = programId.replace(/^lv/, '');
  const candidates = [
    `https://papi.live.nicovideo.jp/programs/${programId}/comments?limit=50`,
    `https://papi.live.nicovideo.jp/programs/${numeric}/comments?limit=50`,
    `https://papi.live.nicovideo.jp/v1/programs/${programId}/comments?limit=50`,
    `https://live.nicovideo.jp/api/programs/${programId}/comments`,
    `https://live.nicovideo.jp/api/programs/${numeric}/comments`,
    `https://live.nicovideo.jp/front/api/programs/${programId}/comments`,
  ];
  for(const url of candidates){
    try{
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log('\n---', url, 'status=', r.status);
      const t = await r.text();
      try{ console.log(JSON.stringify(JSON.parse(t), null, 2).slice(0, 2000)); } catch { console.log(t.slice(0,2000)); }
    }catch(e){ console.error('err', url, e); }
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
