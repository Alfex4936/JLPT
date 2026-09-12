// 덱 개수표 → data/manifest.js
//
// 시작 화면은 "단어 9,543개 / 한자 2,142자" 같은 개수만 있으면 그려진다.
// 그 개수 때문에 4.5MB 를 파싱하고 있었다 — 개수만 따로 빼서 덱을 나중에 부른다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'manifest.js');

global.window = { JLPT: [] };
for (const lv of [5, 4, 3, 2, 1]) {
  const f = path.join(ROOT, 'data', `words-n${lv}.js`);
  if (fs.existsSync(f)) require(f);
}
const KF = path.join(ROOT, 'data', 'kanji.js');
if (fs.existsSync(KF)) require(KF);
const RF = path.join(ROOT, 'data', 'reading.js');
if (fs.existsSync(RF)) require(RF);

const byLevel = (list, get) => {
  const c = {};
  for (const x of list || []) {
    const lv = Number(get(x));
    if (lv >= 1 && lv <= 5) c[lv] = (c[lv] || 0) + 1;
  }
  return c;
};

const words = byLevel(global.window.JLPT, (w) => w.lv);
const kanji = byLevel(global.window.JLPT_KANJI, (k) => k.lv);
const reading = (global.window.JLPT_READING && global.window.JLPT_READING.a || []).length;

const sum = (o) => Object.keys(o).reduce((s, k) => s + o[k], 0);

fs.writeFileSync(OUT, [
  '/* 생성물 - tools/build-manifest.js. 직접 고치지 말 것.',
  '   덱 파일은 모드에 들어갈 때 불러온다. 시작 화면은 이 개수표만 본다. */',
  'window.JLPT_N = {',
  '  words: ' + JSON.stringify(words) + ',',
  '  kanji: ' + JSON.stringify(kanji) + ',',
  '  reading: ' + reading,
  '};',
  ''
].join('\n'));

console.log('data/manifest.js  단어 ' + sum(words) + ' · 한자 ' + sum(kanji) + ' · 기사 ' + reading);
