// kanji-base.json + kout/*.jsonl -> data/kanji.js
const fs = require('fs');
const path = require('path');

const SCRATCH = process.env.SCRATCH || path.join(__dirname, 'cache');
const BUILD = path.join(SCRATCH, 'build');
const OUTDIR = path.join(BUILD, 'kout');
const DATA = path.join(__dirname, '..', 'data');

const BASE = fs.existsSync(path.join(BUILD, 'kanji-base.json'))
  ? path.join(BUILD, 'kanji-base.json')
  : path.join(__dirname, 'cache', 'kanji-base.json');
const base = new Map(JSON.parse(fs.readFileSync(BASE, 'utf8')).map((x) => [x.c, x]));

const issues = { badJson: 0, unknown: 0, dupe: 0, noKo: 0, noHun: 0, hunMismatch: [] };
const got = new Map();
for (const f of (fs.existsSync(OUTDIR) ? fs.readdirSync(OUTDIR) : []).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(OUTDIR, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { issues.badJson++; continue; }
    const b = base.get(o.c);
    if (!b) { issues.unknown++; continue; }
    if (got.has(o.c)) { issues.dupe++; continue; }
    const ko = Array.isArray(o.ko) ? o.ko.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
    if (!ko.length) { issues.noKo++; continue; }
    let hun = typeof o.hun === 'string' ? o.hun.trim() : '';
    // 훈음의 음절은 그 한자의 한국 한자음이어야 한다. 어긋나면 훈음을 버린다 —
    // 틀린 훈음은 없는 것보다 나쁘다 (사용자가 한자음을 그걸로 외운다).
    if (hun && b.hj) {
      const last = hun.split(/\s+/).pop();
      if (last !== b.hj) { issues.hunMismatch.push(`${o.c}:${hun}≠${b.hj}`); hun = ''; }
    }
    if (!hun) issues.noHun++;
    got.set(o.c, { ko, hun });
  }
}

const rows = [];
let n = 0;
for (const [c, b] of base) {
  const t = got.get(c);
  if (!t) continue;
  rows.push({
    i: 'k' + (n++), lv: b.lv, c, st: b.st || 0,
    hj: b.hj || null, hun: t.hun || null, ko: t.ko,
    on: b.on, onH: b.onH, kun: b.kun, kunH: b.kunH,
    en: b.en || '',
    ex: b.ex,
  });
}
rows.sort((a, b) => b.lv - a.lv);

const byLv = {};
for (const r of rows) byLv[r.lv] = (byLv[r.lv] || 0) + 1;
const body = rows.map((r) => JSON.stringify(r)).join(',\n');
fs.writeFileSync(path.join(DATA, 'kanji.js'),
  `// JLPT 한자 ${rows.length}자 · 자동 생성 (tools/merge-kanji.js)\nwindow.JLPT_KANJI = window.JLPT_KANJI || [];\nwindow.JLPT_KANJI.push(...[\n${body}\n]);\n`);

console.log(`data/kanji.js  ${rows.length}자  ${(fs.statSync(path.join(DATA, 'kanji.js')).size / 1024).toFixed(0)}KB`);
console.log('급수별', JSON.stringify(byLv), '| base', base.size, '| 결손', base.size - rows.length);
console.log('훈음 있음', rows.filter((r) => r.hun).length, '| 한자음 있음', rows.filter((r) => r.hj).length);
console.log('이슈', JSON.stringify({ ...issues, hunMismatch: issues.hunMismatch.slice(0, 12) }));
if (base.size !== rows.length) {
  const miss = [...base.keys()].filter((c) => !got.has(c));
  console.log('빠진 한자', miss.join('') || '-');
}
