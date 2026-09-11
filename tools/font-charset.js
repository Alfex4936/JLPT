// 폰트 서브셋용 문자 집합 추출.
// 데이터와 UI에 실제로 등장하는 글자만 모은다 — 폰트별로 필요한 스크립트가 다르다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'charset');
fs.mkdirSync(OUT, { recursive: true });

global.window = { JLPT: [], JLPT_KANJI: [] };
for (const lv of [5, 4, 3, 2, 1]) {
  const f = path.join(ROOT, 'data', `words-n${lv}.js`);
  if (fs.existsSync(f)) require(f);
}
const KF = path.join(ROOT, 'data', 'kanji.js');
if (fs.existsSync(KF)) require(KF);
const KNF = path.join(ROOT, 'data', 'kana.js');
if (fs.existsSync(KNF)) require(KNF);
const RDF = path.join(ROOT, 'data', 'reading.js');
if (fs.existsSync(RDF)) require(RDF);
const W = global.window.JLPT;
const KJ = global.window.JLPT_KANJI;
const KN = global.window.JLPT_KANA;
const RD = global.window.JLPT_READING;

// UI 문자 (마크업·스크립트 안의 한국어·기호 전부)
// style.css 도 읽는다 — content: "음"/"훈" 처럼 CSS 안에만 있는 글자가 서브셋에서 빠지면 안 된다
const ui = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'assets', 'style.css'), 'utf8');

const add = (set, s) => { for (const ch of String(s || '')) set.add(ch); };

// 라틴·숫자·기본 기호는 어느 폰트에나 넣어 둔다 (UI 숫자, N5 배지 등)
const BASE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
  + 'abcdefghijklmnopqrstuvwxyz{|}~·★☆…—‧、。「」々〜～×';

const word = new Set();  // Klee One: 표기(headword)만
const jp = new Set();    // Noto Sans JP: かな 읽기, 예문, 한자별 한자음의 한자
const kr = new Set();    // Noto Sans KR: 한글 전부 + UI
const kana = new Set();  // かな 글꼴 6종: かな 만. 한자는 안 담으므로 단어 카드에서는 한자만 폴백된다

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
// 한자 카드: 큰 글씨는 한자 한 자, 음독·훈독은 かな, 훈음·뜻은 한글, 예시 단어는 표기+かな+한글
for (const k of KJ) {
  add(word, k.c);
  add(jp, k.c);
  // 음독·훈독은 .hjp i b 가 그리고 그 셀렉터는 --f-word(Klee One) 다 — word 집합에도 넣어야 한다
  (k.on || []).forEach((v) => { add(jp, v); add(word, v); });
  (k.kun || []).forEach((v) => { add(jp, v); add(word, v); });
  add(kr, k.hj); add(kr, k.hun);
  (k.ko || []).forEach((m) => add(kr, m));
  add(kr, k.en);
  (k.ex || []).forEach(function (e) {
    add(word, e[0]); add(jp, e[0]); add(jp, e[1]);
    add(kr, e[2]); add(kr, e[3]);
  });
  (k.onH || []).concat(k.kunH || []).forEach((v) => add(kr, v));
}

// かな 카드: 큰 글씨는 かな 한 자, 로마자는 라틴, 한글 표기는 KR 폰트
for (const c in (KN ? KN.i : {})) {
  add(word, c); add(jp, c); add(kana, c);
  add(kr, KN.i[c].h);
}
for (const g of (KN ? KN.g : [])) add(kr, g.n);

/* 읽기 기사: 본문 한자·かな 는 JP 가 그리고(루비도 JP), 번역은 KR 이 그린다.
   기사 한자는 덱에 없는 글자가 섞여 있다 — 여기서 안 담으면 그 글자만 시스템 폰트로 튄다. */
for (const a of (RD ? RD.a : [])) {
  const parts = a.t.concat(...a.s.map((x) => x.r));
  for (const [t, r] of parts) { add(jp, t); add(word, t); if (r) { add(jp, r); add(kana, r); } }
  add(kr, a.to);
  for (const x of a.s) add(kr, x.o);
  add(jp, a.tk);
  for (const x of a.s) add(jp, x.k);
}
if (RD && RD.src) { add(kr, RD.src.name); add(jp, RD.src.name); }

// かな 글꼴은 데이터에 등장하는 かな 전부를 담는다 — 단어·한자 모드에서도 고를 수 있기 때문이다
const isKana = (c) => { const n = c.codePointAt(0); return (n >= 0x3040 && n <= 0x30ff) || n === 0xff70; };
for (const c of jp) if (isKana(c)) kana.add(c);
add(kana, BASE);

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
console.log('kana (かな 글꼴 6종) ', write('kana', kana), '자 |', stat(kana));
