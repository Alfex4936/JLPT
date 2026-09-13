// ja.wikinews.org 기사 수집 → SCRATCH/build/wikinews.json
// 라이선스: CC BY 4.0 (API 의 rightsinfo 로 확인). 저작자 표시가 필요하므로 제목·URL·기여자를 같이 받는다.
//
// 읽을 만한 기사를 고르는 게 이 스크립트의 절반이다 — 사용자는 한자를 못 읽으므로
// 우리 덱(한자 2,142자 · 단어 9,543개)과 겹치는 비율이 높은 기사를 위로 올린다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = 'https://ja.wikinews.org/w/api.php';
const UA = { 'User-Agent': 'jlpt-reading-builder/0.1 (offline study app; https://github.com/Alfex4936/JLPT)' };
const OUT = process.env.SCRATCH
  ? path.join(process.env.SCRATCH, 'build', 'wikinews.json')
  : path.join(__dirname, 'cache', 'wikinews.json');

const WANT = Number(process.env.WANT || 40);        // 최종으로 남길 기사 수
const SCAN = Number(process.env.SCAN || 600);       // 훑어볼 후보 수

const KANJI = /[一-鿿々〆ヶ]/;
const NS_JUNK = /^(ポータル|テンプレート|ウィキニュース|利用者|カテゴリ|Category|MediaWiki|Help|ヘルプ|ファイル)[:：]/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const q = new URLSearchParams(Object.assign({ format: 'json', formatversion: '2' }, params));
  for (let t = 0; t < 4; t++) {
    try {
      const res = await fetch(API + '?' + q, { headers: UA });
      if (res.ok) return await res.json();
    } catch (e) {}
    await sleep(400 * (t + 1));
  }
  throw new Error('api 실패: ' + q);
}

// 우리 덱을 읽어 둔다 (없어도 동작하되 난이도 점수만 못 매긴다)
function loadDeck() {
  global.window = { JLPT: [], JLPT_KANJI: [] };
  for (const lv of [5, 4, 3, 2, 1]) {
    const f = path.join(ROOT, 'data', `words-n${lv}.js`);
    if (fs.existsSync(f)) require(f);
  }
  const kf = path.join(ROOT, 'data', 'kanji.js');
  if (fs.existsSync(kf)) require(kf);
  const kanji = new Set(global.window.JLPT_KANJI.map((k) => k.c));
  const lvOf = {};
  for (const k of global.window.JLPT_KANJI) lvOf[k.c] = k.lv;
  return { kanji, lvOf, words: global.window.JLPT.length };
}

/* 본문 정리. extracts 는 위키 문법을 지워 주지만 뉴스 특유의 찌꺼기가 남는다:
   【날짜】머리, == 情報源 == 이후의 출처 목록, 표·틀 잔해. */
function clean(extract) {
  let t = String(extract || '').replace(/\r/g, '');
  let date = '';
  const m = t.match(/【([^】]{4,30})】/);
  if (m) { date = m[1].trim(); t = t.replace(m[0], ''); }
  /* 출처·관련 섹션부터는 본문이 아니다.
     explaintext 는 소제목을 == == 없이 '그냥 한 줄'로 내놓는다 — 그래서 == 로만 자르면
     참고문헌(『…』 — 読売新聞, 2006年8月10日)이 본문 문장으로 섞여 들어온다. 줄 단위로도 자른다. */
  const TAIL = /^(情報源|出典|典拠|関連記事|関連ニュース|関連項目|脚注|注釈|外部リンク|参考文献|ソース)$/;
  const lines = t.split('\n');
  const cut = lines.findIndex((l) => TAIL.test(l.replace(/^==+\s*|\s*==+$/g, '').trim()));
  if (cut >= 0) t = lines.slice(0, cut).join('\n');
  t = t.replace(/^\s*==+.*?==+\s*$/gm, '');          // 남은 소제목
  t = t.replace(/\{\{[^}]*\}\}/g, '');               // 틀 잔해
  t = t.replace(/\[\[|\]\]/g, '');
  t = t.replace(/[ \t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return { text: t, date };
}

// 문장 분리. 。로 끊되 「」 안의 。는 자르지 않는다.
function sentences(text) {
  const out = [];
  let buf = '', depth = 0;
  for (const ch of text) {
    if (ch === '「' || ch === '『' || ch === '（' || ch === '(') depth++;
    else if (ch === '」' || ch === '』' || ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '\n') { if (buf.trim()) { out.push(buf.trim()); buf = ''; } continue; }
    buf += ch;
    if (ch === '。' && !depth) { out.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 1);
}

/* 서술문 개수. 뉴스 기사에는 표·목록이 본문처럼 섞여 들어온다 —
   「準々決勝以降」「杉本憲也 43 無 新 13,522票」「2025年2月17日 (月): 台風1号 が発生」 같은 줄이다.
   읽기 교재로는 쓸 수 없고(문장이 아니다), 이런 줄이 본문의 3분의 1을 넘으면 기사째로 버린다.
   문장 단위로 남은 찌꺼기는 번역을 비워 두는 것으로 merge-reading 이 걸러낸다. */
const prose = (sents) => sents.filter((s) => /[。？！」]$/.test(s)).length;

/* 읽을 만한가. 낮을수록 쉽다.
   - 덱에 없는 한자가 많으면 벌점 (그 글자는 카드로 본 적이 없다)
   - 문장이 길수록 벌점
   - 라틴 문자·표 찌꺼기가 많으면 벌점 */
function score(sents, deck) {
  const body = sents.join('');
  const ks = [...body].filter((c) => KANJI.test(c));
  if (!ks.length) return null;
  let unknown = 0, lvSum = 0;
  for (const c of ks) {
    if (deck.kanji.has(c)) lvSum += (6 - (deck.lvOf[c] || 1));   // N5=1 … N1=5
    else unknown++;
  }
  const avgLen = body.length / sents.length;
  const latin = (body.match(/[A-Za-z]/g) || []).length / body.length;
  return {
    unknownRatio: unknown / ks.length,
    avgLen,
    latin,
    hardness: (unknown / ks.length) * 100 + (lvSum / ks.length) * 6 + avgLen * 0.25 + latin * 60
  };
}

(async () => {
  const deck = loadDeck();
  console.log('덱 기준 — 한자 ' + deck.kanji.size + '자 · 단어 ' + deck.words + '개');

  // 1) 후보 제목 모으기
  const titles = [];
  let from = process.env.FROM || '';
  while (titles.length < SCAN) {
    const j = await api({
      action: 'query', list: 'allpages', apnamespace: '0',
      aplimit: '500', apfilterredir: 'nonredirects', apfrom: from
    });
    const pages = (j.query && j.query.allpages) || [];
    for (const p of pages) if (!NS_JUNK.test(p.title)) titles.push(p.title);
    if (!j.continue) break;
    from = j.continue.apcontinue;
    await sleep(120);
  }
  console.log('후보 제목 ' + titles.length + '개');

  // 2) 본문 받기 (20개씩)
  const arts = [];
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const j = await api({
      action: 'query', prop: 'extracts|info', explaintext: '1', exsectionformat: 'plain',
      inprop: 'url', titles: batch.join('|')
    });
    for (const p of (j.query && j.query.pages) || []) {
      if (!p.extract) continue;
      const { text, date } = clean(p.extract);
      const sents = sentences(text);
      if (sents.length < 3 || sents.length > 18) continue;
      if (sents.some((s) => s.length > 180)) continue;
      if (prose(sents) < 3 || (sents.length - prose(sents)) / sents.length > 1 / 3) continue;  // 표·목록이 본문인 기사
      const sc = score(sents, deck);
      if (!sc) continue;
      arts.push({
        id: p.pageid, title: p.title, url: p.fullurl, date,
        sents, n: sents.length, ...sc
      });
    }
    process.stdout.write('\r본문 ' + Math.min(i + 20, titles.length) + '/' + titles.length + ' · 쓸만한 기사 ' + arts.length + '개  ');
    await sleep(120);
  }
  console.log('');

  arts.sort((a, b) => a.hardness - b.hardness);
  const picked = arts.slice(0, WANT);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    source: 'ja.wikinews.org', license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    fetched: new Date().toISOString().slice(0, 10),
    articles: picked
  }, null, 1));

  console.log('\n' + OUT);
  console.log('수집 ' + arts.length + '개 중 쉬운 순으로 ' + picked.length + '개 저장');
  const avg = (f) => (picked.reduce((a, x) => a + f(x), 0) / picked.length).toFixed(2);
  console.log('평균 — 문장 ' + avg((x) => x.n) + '개 · 문장길이 ' + avg((x) => x.avgLen) + '자 · 덱에 없는 한자 ' + (avg((x) => x.unknownRatio) * 100).toFixed(1) + '%');
  console.log('\n가장 쉬운 5개:');
  picked.slice(0, 5).forEach((a) => console.log('  [' + a.n + '문장 · 미지한자 ' + (a.unknownRatio * 100).toFixed(0) + '%] ' + a.title));
})();
