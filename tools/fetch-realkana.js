// realkana.com JLPT 단어 덱 추출 -> 우리 덱에 없는 것만 tools/rk-words.json
//
// 그 사이트에는 내보내기·붙여넣기 기능이 없다. 대신 Next.js RSC 페이로드에 덱 전체가 실려 온다 —
// 딱 한 번 요청하면 38개 페이지(N5 3 · N4 4 · N3 13 · N2 6 · N1 12) 5,415장이 전부 들어 있다.
// 플래시카드를 넘겨서 긁을 필요가 없다.
//
// 이 목록은 tanos 파생이 아니다. 우리 덱에 없던 단어가 950개였고, 実무·IT 어휘가 많다
// (検索 更新 添付 返信 送信 画面 入力 残業 本社 会社員 携帯電話 領収書 振り込む …).
//
// 필요: JMDICT=<jmdict-eng-common-*.json 경로> — 이형태와 동음이의를 가르는 데 쓴다.
const fs = require('fs');
const path = require('path');

const URL = 'https://realkana.com/kanji/jlpt/words/1/2';
const OUT = path.join(__dirname, 'rk-words.json');
const JMDICT = process.env.JMDICT;

// 페이지 수가 급수 순으로 나열된다. 사이트 구성이 바뀌면 이 표부터 확인할 것.
const PAGES = [[5, 3], [4, 4], [3, 13], [2, 6], [1, 12]];

function extractArray(src, key) {
  const k = src.indexOf('"' + key + '":');
  if (k < 0) return null;
  const i = src.indexOf('[', k);
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return null;
}

const kanaOnly = (s) => /^[ぁ-んァ-ヴーゝゞ・]+$/.test(s);
const kanjiOf = (s) => new Set([...String(s)].filter((c) => /[一-鿿]/.test(c)));
const shareKanji = (a, b) => { const A = kanjiOf(a); for (const c of kanjiOf(b)) if (A.has(c)) return true; return false; };

(async () => {
  const res = await fetch(URL, { headers: { RSC: '1', 'User-Agent': 'Mozilla/5.0' } });
  const body = await res.text();
  const tables = JSON.parse(extractArray(body, 'cardColumnTables'));
  const lvByTable = [];
  for (const [lv, n] of PAGES) for (let i = 0; i < n; i++) lvByTable.push(lv);
  if (tables.length !== lvByTable.length) {
    console.error(`테이블 ${tables.length}개, 기대 ${lvByTable.length}개 — PAGES 표를 다시 맞춰야 한다`);
    process.exit(1);
  }
  const cards = [];
  tables.forEach((tab, ti) => tab.forEach((col) => col.forEach((c) => {
    cards.push({ w: c.question, k: (c.answers || [])[0] || '', lv: lvByTable[ti] });
  })));
  console.log('realkana 카드', cards.length);

  global.window = { JLPT: [] };
  for (const lv of [5, 4, 3, 2, 1]) {
    const f = path.join(__dirname, '..', 'data', `words-n${lv}.js`);
    if (fs.existsSync(f)) require(f);
  }
  const W = global.window.JLPT;
  const oursW = new Set(), byRead = new Map();
  for (const x of W) {
    oursW.add(x.w);
    for (const a of (x.wAlt || [])) oursW.add(a);
    if (!byRead.has(x.k)) byRead.set(x.k, []);
    byRead.get(x.k).push(x);
  }

  // JMdict: 같은 엔트리를 공유하면 같은 단어의 다른 표기(旨い↔うまい), 아니면 동음이의(韓国↔勧告)
  const entryOf = new Map(), glossOf = new Map();
  if (JMDICT) {
    for (const e of JSON.parse(fs.readFileSync(JMDICT, 'utf8')).words) {
      const reads = (e.kana || []).map((x) => x.text);
      const gloss = (e.sense || []).flatMap((s) => (s.gloss || []).map((g) => g.text)).slice(0, 3).join(', ');
      for (const f of [...(e.kanji || []).map((x) => x.text), ...reads]) for (const r of reads) {
        const key = f + '|' + r;
        if (!entryOf.has(key)) entryOf.set(key, new Set());
        entryOf.get(key).add(e.id);
        if (!glossOf.has(key)) glossOf.set(key, gloss);
      }
    }
  } else console.error('JMDICT 미지정 — 이형태 판정이 한자 공유 여부로만 이뤄진다');

  const keep = [], variants = [];
  for (const c of cards) {
    if (!c.w || !c.k || !kanaOnly(c.k)) continue;
    if (oursW.has(c.w)) continue;
    if (kanaOnly(c.w) && byRead.has(c.w)) continue;
    const mine = byRead.get(c.k) || [];
    if (mine.length) {
      const ids = entryOf.get(c.w + '|' + c.k);
      let verdict = null;
      for (const x of mine) {
        const oid = entryOf.get(x.w + '|' + x.k);
        if (!ids || !oid) continue;
        let hit = false;
        for (const i of ids) if (oid.has(i)) hit = true;
        if (hit) { verdict = 'variant'; break; }
        verdict = 'diff';
      }
      if (verdict === 'variant') { variants.push(c.w); continue; }
      if (verdict !== 'diff') {
        // 사전으로 판정 불가: 한자를 하나도 공유하지 않으면 다른 단어로 본다 (件名 vs 懸命)
        const diff = kanjiOf(c.w).size > 0 && mine.every((x) => !shareKanji(c.w, x.w));
        if (!diff) { variants.push(c.w); continue; }
      }
    }
    keep.push({ w: c.w, k: c.k, lv: c.lv, en: glossOf.get(c.w + '|' + c.k) || '' });
  }
  const seen = new Set(), rows = [];
  for (const r of keep) { const k = r.w + '|' + r.k; if (seen.has(k)) continue; seen.add(k); rows.push(r); }
  rows.sort((a, b) => b.lv - a.lv || a.w.localeCompare(b.w, 'ja'));
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));

  const byLv = {};
  for (const r of rows) byLv['N' + r.lv] = (byLv['N' + r.lv] || 0) + 1;
  console.log('신규', rows.length, JSON.stringify(byLv), '| 이형태 제외', variants.length);
  console.log('영어힌트', rows.filter((r) => r.en).length, '/', rows.length);
  console.log('제외된 이형태:', variants.join(' ') || '-');
})();
