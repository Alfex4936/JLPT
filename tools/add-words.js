// tools/gap-words.json 의 누락 어휘를 base.json 에 덧붙이고 번역용 청크 TSV 를 만든다.
// 원천(jlpt-vocab-api)이 tanos 목록의 이형태·접사 행을 처리하다 흘린 단어들이다 (顔·父·母 포함).
const fs = require('fs');
const path = require('path');
const { kanaToHangul } = require('./kana2hangul');

const SCRATCH = process.env.SCRATCH;
if (!SCRATCH) { console.error('SCRATCH 필요 (kanjidic2.xml 과 build/ 가 있는 디렉터리)'); process.exit(1); }
const BUILD = path.join(SCRATCH, 'build');
const CHUNK = Number(process.env.CHUNK || 140);

const xml = fs.readFileSync(path.join(SCRATCH, 'kanjidic2.xml'), 'utf8');
const kanjiKo = {};
for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
  const lit = m[1].match(/<literal>(.*?)<\/literal>/);
  const ko = m[1].match(/<reading r_type="korean_h">(.*?)<\/reading>/);
  if (lit && ko) kanjiKo[lit[1]] = ko[1];
}

const isKanji = (c) => /[一-鿿㐀-䶿]/.test(c);
function hanjaeum(word) {
  const chars = [...word].filter(isKanji);
  if (!chars.length) return null;
  const per = chars.map((c) => ({ k: c, ko: kanjiKo[c] || null }));
  if (per.some((p) => !p.ko)) return per.every((p) => !p.ko) ? null : { per, joined: null };
  return { per, joined: per.map((p) => p.ko).join('') };
}

const base = JSON.parse(fs.readFileSync(path.join(BUILD, 'base.json'), 'utf8'));
const have = new Set(base.map((x) => x.w + '|' + x.k));
let nextId = Math.max(...base.map((x) => x.id)) + 1;

const gap = JSON.parse(fs.readFileSync(path.join(__dirname, 'gap-words.json'), 'utf8'));
const added = [];
for (const g of gap) {
  const key = g.w + '|' + g.k;
  if (have.has(key)) continue;
  have.add(key);
  const hj = hanjaeum(g.w);
  added.push({
    w: g.w, k: g.k, h: kanaToHangul(g.k), r: '', en: g.en, lv: g.lv,
    hj: hj && hj.joined ? hj.joined : null,
    hjp: hj ? hj.per.map((p) => p.k + (p.ko || '?')).join(' ') : null,
    id: nextId++,
  });
}
const all = base.concat(added);
fs.writeFileSync(path.join(BUILD, 'base.json'), JSON.stringify(all));
fs.writeFileSync(path.join(__dirname, 'cache', 'base.json'), JSON.stringify(all));

const byLv = {};
for (const x of added) byLv[x.lv] = (byLv[x.lv] || 0) + 1;
console.log('추가', added.length, '/ 전체', all.length, 'byLevel', JSON.stringify(byLv));
console.log('한자음 확보', added.filter((x) => x.hj).length, '| ? 포함', added.filter((x) => x.hjp && x.hjp.includes('?')).map((x) => x.w).join(' ') || '없음');

// 청크: 급수 섞어서 gap-pNN. 이름을 분리해 기존 62개 청크와 섞이지 않게 한다.
const manifest = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'))
  .filter((m) => !m.name.startsWith('gap-'));
for (let i = 0, part = 1; i < added.length; i += CHUNK, part++) {
  const slice = added.slice(i, i + CHUNK);
  const name = `gap-p${String(part).padStart(2, '0')}`;
  const tsv = slice.map((x) => [x.id, x.w, x.k, x.en].join('\t')).join('\n');
  fs.writeFileSync(path.join(BUILD, 'chunks', name + '.tsv'), tsv + '\n');
  manifest.push({ name, level: 0, count: slice.length, first: slice[0].w, last: slice.at(-1).w });
  console.log('청크', name, slice.length);
}
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(manifest, null, 1));
