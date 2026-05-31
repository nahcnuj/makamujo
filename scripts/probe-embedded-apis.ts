import { extractEmbeddedDataFromHtml } from '../lib/niconamaCommentClient';

const WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';

async function fetchText(url: string, opts: any = {}){
  try{
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, ...opts });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers };
  }catch(e){ return { status: 0, text: String(e), headers: {} }; }
}

async function main(){
  console.log('Fetching page', WATCH_URL);
  const page = await fetchText(WATCH_URL);
  if (page.status === 0) { console.error('fetch failed', page.text); process.exit(1); }
  const embedded = extractEmbeddedDataFromHtml(page.text);
  if (!embedded) { console.error('no embedded'); process.exit(1); }
  const prog = (embedded as any).program;
  const site = (embedded as any).site;
  const relive = (embedded as any).relive;
  console.log('programId', prog?.nicoliveProgramId);
  const programId = prog?.nicoliveProgramId;
  const numeric = programId ? programId.replace(/^lv/, '') : null;
  const candidates: string[] = [];
  if (site?.pollingApiBaseUrl) candidates.push(`${site.pollingApiBaseUrl}programs/${programId}/comments?limit=100`);
  if (site?.frontendPublicApiUrl) candidates.push(`${site.frontendPublicApiUrl}programs/${programId}/comments?limit=100`);
  if (site?.frontendPublicApiUrl) candidates.push(`${site.frontendPublicApiUrl}programs/${numeric}/comments?limit=100`);
  if (relive?.apiBaseUrl) candidates.push(`${relive.apiBaseUrl}programs/${programId}/comments?limit=100`);
  if (relive?.apiBaseUrl) candidates.push(`${relive.apiBaseUrl}programs/${numeric}/comments?limit=100`);
  // common legacy endpoints
  candidates.push(`https://live.nicovideo.jp/api/programs/${programId}/comments`);
  candidates.push(`https://live.nicovideo.jp/front/api/programs/${programId}/comments`);
  candidates.push(`https://papi.live.nicovideo.jp/programs/${programId}/comments`);
  candidates.push(`https://papi.live.nicovideo.jp/programs/${numeric}/comments`);
  candidates.push(`https://live2.nicovideo.jp/unama/api/v2/programs/${programId}/comments`);
  candidates.push(`https://live2.nicovideo.jp/unama/api/v2/programs/${numeric}/comments`);

  const tried = new Set<string>();
  for (const url of candidates) {
    if (!url) continue;
    if (tried.has(url)) continue;
    tried.add(url);
    console.log('\n--- GET', url);
    const r = await fetchText(url);
    console.log('status:', r.status);
    const s = r.text || '';
    console.log(s.slice(0,4000));
    if (s.includes('comment') || s.includes('commentCount') || s.includes('body') || s.includes('text')){
      console.log('-> contains comment-like keywords');
    }
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
