// 폰트 서브셋용 문자 집합 추출.
// 데이터와 UI에 실제로 등장하는 글자만 모은다 — 폰트별로 필요한 스크립트가 다르다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'charset');
fs.mkdirSync(OUT, { recursive: true });

global.window = { JLPT: [] };
for (const lv of [5, 4, 3, 2, 1]) {
  const f = path.join(ROOT, 'data', `words-n${lv}.js`);
  if (fs.existsSync(f)) require(f);
}
const W = global.window.JLPT;

// UI 문자 (마크업·스크립트 안의 한국어·기호 전부)
const ui = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');

const add = (set, s) => { for (const ch of String(s || '')) set.add(ch); };

// 라틴·숫자·기본 기호는 어느 폰트에나 넣어 둔다 (UI 숫자, N5 배지 등)
const BASE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
  + 'abcdefghijklmnopqrstuvwxyz{|}~·★☆…—‧、。「」々〜～×';

const word = new Set();  // Klee One: 표기(headword)만
const jp = new Set();    // Noto Sans JP: かな 읽기, 예문, 한자별 한자음의 한자
const kr = new Set();    // Noto Sans KR: 한글 전부 + UI

const isHangul = (c) => c.codePointAt(0) >= 0xac00 && c.codePointAt(0) <= 0xd7a3;
const onlyHangul = (s) => [...String(s || '')].filter(isHangul).join('');

add(word, BASE);
add(jp, BASE);
add(kr, BASE);
add(kr, ui);   // UI 문구는 한국어라 KR 폰트가 그린다

for (const x of W) {
  add(word, x.w);
  (x.wAlt || []).forEach((v) => add(word, v));

  add(jp, x.k);
  (x.kAlt || []).forEach((v) => add(jp, v));
  add(jp, x.e); add(jp, x.ek);
  add(jp, x.w);             // Klee 로딩 실패 시 Noto JP 가 표기를 대신 그린다
  add(jp, x.hjp);           // 「時 시」의 한자 쪽 — CSS 에서 .hjp b 는 JP 폰트

  // KR 폰트에는 한글만. 한자를 넣으면 Noto Sans KR 이 2천 자 분량 더 커진다.
  add(kr, x.h); add(kr, x.hL);
  add(kr, x.eh); add(kr, x.ehL);
  add(kr, x.hj);
  add(kr, onlyHangul(x.hjp));
  (x.ko || []).forEach((m) => add(kr, m));
  add(kr, x.p); add(kr, x.eo);
  add(kr, x.en);
}
// JP 폰트에서 한글 제거 (한글은 KR 폰트 담당)
for (const c of [...jp]) if (isHangul(c)) jp.delete(c);

const write = (name, set) => {
  const chars = [...set].filter((c) => c !== '\n' && c !== '\r' && c !== '\t').sort().join('');
  fs.writeFileSync(path.join(OUT, name + '.txt'), chars);
  return chars.length;
};

const stat = (set) => {
  let kanji = 0, kana = 0, hangul = 0, other = 0;
  for (const c of set) {
    const n = c.codePointAt(0);
    if (n >= 0x4e00 && n <= 0x9fff) kanji++;
    else if (n >= 0x3040 && n <= 0x30ff) kana++;
    else if (n >= 0xac00 && n <= 0xd7a3) hangul++;
    else other++;
  }
  return `한자 ${kanji} · かな ${kana} · 한글 ${hangul} · 기타 ${other}`;
};

console.log('word (Klee One)   ', write('word', word), '자 |', stat(word));
console.log('jp   (Noto Sans JP)', write('jp', jp), '자 |', stat(jp));
console.log('kr   (Noto Sans KR)', write('kr', kr), '자 |', stat(kr));
