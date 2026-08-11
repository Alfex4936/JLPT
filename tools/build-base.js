// 원천 데이터(jlpt-vocab-api) + KANJIDIC2(한국 한자음) -> base.json + 번역 에이전트용 청크
const fs = require('fs');
const path = require('path');
const { kanaToHangul } = require('./kana2hangul');

const SCRATCH = process.env.SCRATCH;
const DB = path.join(SCRATCH, 'jlpt-vocab-api-main/data-source/db');
const OUT = path.join(SCRATCH, 'build');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'chunks'), { recursive: true });

// --- KANJIDIC2: 한자 -> 한국 한자음
const xml = fs.readFileSync(path.join(SCRATCH, 'kanjidic2.xml'), 'utf8');
const kanjiKo = {};
for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
  const body = m[1];
  const lit = body.match(/<literal>(.*?)<\/literal>/);
  if (!lit) continue;
  const ko = body.match(/<reading r_type="korean_h">(.*?)<\/reading>/);
  if (ko) kanjiKo[lit[1]] = ko[1];
}

const isKanji = (c) => /[一-鿿㐀-䶿]/.test(c);

function hanjaeum(word) {
  const chars = [...word].filter(isKanji);
  if (!chars.length) return null;
  const per = chars.map((c) => ({ k: c, ko: kanjiKo[c] || null }));
  if (per.some((p) => !p.ko)) return per.every((p) => !p.ko) ? null : { per, joined: null };
  return { per, joined: per.map((p) => p.ko).join('') };
}

// --- 단어 병합 + 중복 제거(표기+읽기 기준, 낮은 급수 우선)
const seen = new Map();
for (const lv of [5, 4, 3, 2, 1]) {
  const rows = JSON.parse(fs.readFileSync(path.join(DB, `n${lv}.json`), 'utf8'));
  for (const r of rows) {
    const word = String(r.word || '').trim();
    const kana = String(r.furigana || r.word || '').trim() || word;
    if (!word) continue;
    const key = word + '|' + kana;
    if (seen.has(key)) continue;
    const hj = hanjaeum(word);
    seen.set(key, {
      w: word,
      k: kana,
      h: kanaToHangul(kana),
      r: r.romaji || '',
      en: String(r.meaning || '').trim(),
      lv,
      hj: hj && hj.joined ? hj.joined : null,
      hjp: hj ? hj.per.map((p) => p.k + (p.ko || '?')).join(' ') : null,
    });
  }
}

const all = [...seen.values()];
all.forEach((x, i) => { x.id = i; });
fs.writeFileSync(path.join(OUT, 'base.json'), JSON.stringify(all));

const byLv = {};
for (const x of all) byLv[x.lv] = (byLv[x.lv] || 0) + 1;
console.log('total', all.length, 'byLevel', JSON.stringify(byLv));
console.log('한자음 확보', all.filter((x) => x.hj).length, '/ 한자포함', all.filter((x) => x.hjp).length);
console.log('한글표기 실패', all.filter((x) => !x.h).length);
console.log('샘플:', all.filter(x=>x.hj).slice(0, 5).map((x) => `${x.w}(${x.k}/${x.h}/${x.hj}) ${x.en}`).join(' | '));

// --- 청크: 급수별로 CHUNK개씩 TSV
const CHUNK = Number(process.env.CHUNK || 280);
const manifest = [];
for (const lv of [5, 4, 3, 2, 1]) {
  const rows = all.filter((x) => x.lv === lv);
  for (let i = 0, part = 1; i < rows.length; i += CHUNK, part++) {
    const slice = rows.slice(i, i + CHUNK);
    const name = `n${lv}-p${String(part).padStart(2, '0')}`;
    const tsv = slice.map((x) => [x.id, x.w, x.k, x.en].join('\t')).join('\n');
    fs.writeFileSync(path.join(OUT, 'chunks', name + '.tsv'), tsv + '\n');
    manifest.push({ name, level: lv, count: slice.length, first: slice[0].w, last: slice.at(-1).w });
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('청크', manifest.length, manifest.map((m) => `${m.name}:${m.count}`).join(' '));
