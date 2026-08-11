// KANJIDIC2 + 우리 단어 덱 -> kanji-base.json + 번역 에이전트용 청크
// 예시 단어는 이미 만들어 둔 data/words-n*.js 에서 뽑는다 — 새로 생성할 필요가 없고,
// 사용자가 이미 카드로 본 단어라 한자와 단어가 서로 보강된다.
const fs = require('fs');
const path = require('path');
const { kanaToHangul } = require('./kana2hangul');
const { KANJI_KO_FIX, initialSoundLaw } = require('./kanji-ko-fix');

const SCRATCH = process.env.SCRATCH;
if (!SCRATCH) { console.error('SCRATCH 필요 (kanjidic2.xml 이 있는 디렉터리)'); process.exit(1); }
const BUILD = path.join(SCRATCH, 'build');
fs.mkdirSync(path.join(BUILD, 'kchunks'), { recursive: true });

// 뜻·훈음만 받으므로 카드 청크(140)보다 출력이 훨씬 작다. 그래서 300 까지 안전하다.
const CHUNK = Number(process.env.CHUNK || 300);
const HAS_KANJI = /[一-鿿㐀-䶿]/;

// --- 우리 덱: 한자별 급수와 예시 단어
global.window = { JLPT: [] };
for (const lv of [5, 4, 3, 2, 1]) require(path.join(__dirname, '..', 'data', `words-n${lv}.js`));
const words = global.window.JLPT;

const lvOf = new Map();
const samples = new Map();
for (const x of words) {
  for (const c of new Set(x.w)) {
    if (!HAS_KANJI.test(c)) continue;
    const prev = lvOf.get(c);
    if (prev === undefined || x.lv > prev) lvOf.set(c, x.lv);
    if (!samples.has(c)) samples.set(c, []);
    samples.get(c).push(x);
  }
}

// --- KANJIDIC2
const xml = fs.readFileSync(path.join(SCRATCH, 'kanjidic2.xml'), 'utf8');
const dic = new Map();
for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
  const b = m[1];
  const lit = b.match(/<literal>(.*?)<\/literal>/);
  if (!lit) continue;
  const rm = b.match(/<reading_meaning>[\s\S]*?<\/reading_meaning>/);
  const scope = rm ? rm[0] : b;
  const pick = (t) => [...scope.matchAll(new RegExp(`<reading r_type="${t}"[^>]*>(.*?)</reading>`, 'g'))].map((x) => x[1]);
  dic.set(lit[1], {
    on: pick('ja_on'),
    kun: pick('ja_kun'),
    ko: (b.match(/<reading r_type="korean_h">(.*?)<\/reading>/) || [])[1] || null,
    // m_lang 이 붙은 건 영어가 아니다
    en: [...scope.matchAll(/<meaning>([^<]+)<\/meaning>/g)].map((x) => x[1]),
    st: Number((b.match(/<stroke_count>(\d+)<\/stroke_count>/) || [])[1] || 0),
    grade: Number((b.match(/<grade>(\d+)<\/grade>/) || [])[1] || 0),
  });
}

// --- 예시 단어 고르기: 낮은 급수 → 한자음=한국어 배지 → 짧은 것
function bestSamples(c) {
  const list = (samples.get(c) || []).slice().sort((a, b) =>
    b.lv - a.lv || (b.same ? 1 : 0) - (a.same ? 1 : 0) || a.w.length - b.w.length);
  const out = [];
  for (const x of list) {
    if (out.length >= 3) break;
    if (out.some((y) => y.w === x.w)) continue;
    out.push(x);
  }
  return out.map((x) => [x.w, x.k, x.h, x.ko[0] || '']);
}

const KANA_CLEAN = (s) => s.replace(/[-.．]/g, '').replace(/\..*$/, '');
const rows = [];
for (const [c, lv] of [...lvOf.entries()].sort((a, b) => b[1] - a[1])) {
  const d = dic.get(c) || { on: [], kun: [], ko: null, en: [], st: 0, grade: 0 };
  const hj = d.ko || KANJI_KO_FIX[c] || null;
  const on = d.on.slice(0, 4);
  const kun = d.kun.map(KANA_CLEAN).filter(Boolean).slice(0, 4);
  rows.push({
    c, lv, st: d.st, grade: d.grade || 0,
    hj: hj ? initialSoundLaw(hj) : null,
    on, kun,
    onH: on.map((s) => kanaToHangul(s)),
    kunH: kun.map((s) => kanaToHangul(s)),
    en: d.en.slice(0, 5).join(', '),
    ex: bestSamples(c),
  });
}
fs.writeFileSync(path.join(BUILD, 'kanji-base.json'), JSON.stringify(rows));

const noHj = rows.filter((r) => !r.hj).map((r) => r.c);
const noEn = rows.filter((r) => !r.en).map((r) => r.c);
const noEx = rows.filter((r) => !r.ex.length).map((r) => r.c);
console.log('한자', rows.length, '| 한자음 없음', noHj.length, noHj.join('') || '-');
console.log('영어뜻 없음', noEn.length, noEn.join('') || '-', '| 예시단어 없음', noEx.length, noEx.join('') || '-');
console.log('샘플:', rows.slice(0, 3).map((r) => `${r.c}(${r.hj}/${r.st}획) on=${r.on} kun=${r.kun} ex=${r.ex.map((e) => e[0]).join(',')}`).join(' | '));

// --- 청크 TSV: 한자, 한자음, 음독, 훈독, 영어뜻, 예시단어
const manifest = [];
for (let i = 0, part = 1; i < rows.length; i += CHUNK, part++) {
  const slice = rows.slice(i, i + CHUNK);
  const name = `k-p${String(part).padStart(2, '0')}`;
  const tsv = slice.map((r) => [
    r.c, r.hj || '', r.on.join('・') || '-', r.kun.join('・') || '-', r.en || '-',
    r.ex.map((e) => e[0]).join('・') || '-',
  ].join('\t')).join('\n');
  fs.writeFileSync(path.join(BUILD, 'kchunks', name + '.tsv'), tsv + '\n');
  manifest.push({ name, count: slice.length, first: slice[0].c, last: slice.at(-1).c });
}
fs.writeFileSync(path.join(BUILD, 'kmanifest.json'), JSON.stringify(manifest, null, 1));
console.log('청크', manifest.length, manifest.map((m) => `${m.name}:${m.count}`).join(' '));
