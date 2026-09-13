// data/reading.js 검사기. 의존성 0. 문제가 있으면 종료 코드 1.
//
// 이게 필요한 이유: 읽기 파이프라인의 유일한 방어선이 "사람이 reading-draft.tsv 를 읽는다" 였다.
// 사람은 800문장을 매번 다시 읽지 못한다. 그래서 자릿점·% 가 かな 읽기에 그대로 박힌 문장
// (やくろく,ゼロにん · さんじゅうご.はちじゅうさん%) 이 배포된 덱에 4개 섞여 있었다.
// 기계로 잡히는 건 기계가 잡는다 — 덱을 다시 만들 때마다 이걸 돌린다.
const fs = require('fs');
const path = require('path');

// 인자로 다른 파일을 줄 수 있다 — 옛 덱에 돌려 이 검사가 실제로 잡는지 확인할 때 쓴다
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'data', 'reading.js');

/* かな 읽기에 있어도 되는 것: かな, 원문에서 온 문장부호, 그리고 라틴 문자.
   라틴을 허용하는 이유: 읽기를 추측할 수 없는 낱말은 일부러 표기 그대로 내보낸다
   (「サンサン」(Shanshan) · (UNFCCC) — Durian 을 ドリアン 이라고 맞힐 수 없으니 추측하지 않는다).
   사용자는 한자를 못 읽어도 라틴은 읽고, TTS 도 라틴은 읽는다. 숫자와 한자는 허용하지 않는다 —
   그건 읽기를 만들지 못했다는 뜻이라 그 문장은 버려야 한다.
   ASCII 하이픈은 제목의 구분선(「訃報 森繁久弥氏 - 映画」)으로만 허용한다 — 양쪽이 공백일 때다.
   かな 에 딱 붙은 하이픈은 읽히지 않은 기호다(UH-1 → ユーエイチ-いち). GLUED 가 그걸 잡는다. */
const KANA_PUNCT = 'ぁ-ゖァ-ヺー・、。「」『』（）()!?？！\\s…―－，:：\\-A-Za-z～〜●';
const ALLOWED = new RegExp('^[' + KANA_PUNCT + ']*$');
const DISALLOWED = new RegExp('[^' + KANA_PUNCT + ']', 'g');
const GLUED = /\S-\S/;

global.window = {};
require(FILE);
const R = global.window.JLPT_READING;

const bad = [];
const fail = (where, msg) => bad.push(where + ': ' + msg);

if (!R || !Array.isArray(R.a)) { console.error('window.JLPT_READING.a 가 없다'); process.exit(1); }
if (!R.src || !R.src.license) fail('src', '라이선스 표기가 없다 — CC BY 요구사항이다');

const surfaceOf = (ruby) => ruby.map(([t]) => t).join('');
const readingOf = (ruby) => ruby.map(([t, r]) => (r == null ? t : r)).join('');

const seen = new Set();
for (const a of R.a) {
  const at = a.i || '?';
  if (seen.has(a.i)) fail(at, '기사 id 가 중복이다');
  seen.add(a.i);
  if (!a.u) fail(at, '원문 주소가 없다 — CC BY 요구사항이다');
  if (!a.to) fail(at, '제목 번역이 없다');
  if (!a.t || !a.t.length) fail(at, '제목 루비가 없다');
  if (a.n !== a.s.length) fail(at, 'n=' + a.n + ' 인데 문장은 ' + a.s.length + '개다');
  if (a.s.length < 3) fail(at, '문장이 3개 미만이다');

  const parts = [{ r: a.t, k: a.tk, o: a.to, tag: '제목' }].concat(
    a.s.map((s, i) => ({ r: s.r, k: s.k, o: s.o, tag: '문장 ' + (i + 1) })));

  for (const p of parts) {
    const where = at + ' ' + p.tag;
    if (!p.r || !p.k) { fail(where, '루비나 읽기가 비어 있다'); continue; }
    if (!p.o) fail(where, '번역이 없다');
    // 루비를 이어 붙이면 원래 읽기가 나와야 한다
    if (readingOf(p.r) !== p.k) fail(where, '루비를 이어 붙인 읽기가 k 와 다르다');
    if (!surfaceOf(p.r)) fail(where, '표기가 비어 있다');
    for (const [t, r] of p.r) {
      if (r === '') fail(where, '「' + t + '」 의 읽기가 빈 문자열이다');
      if (r != null && !ALLOWED.test(r)) fail(where, '「' + t + '」 의 읽기에 かな 가 아닌 글자가 있다: ' + r);
    }
    // 문장 전체 읽기(TTS 가 그대로 읽는 줄)에 한자·숫자·기호가 남아 있으면 안 된다
    if (!ALLOWED.test(p.k)) {
      const junk = [...new Set(p.k.match(DISALLOWED) || [])].join('');
      fail(where, 'かな 읽기에 읽히지 않은 글자가 남았다: ' + junk + '  (' + p.k.slice(0, 40) + ')');
    }
    if (GLUED.test(p.k)) fail(where, 'かな 에 붙은 하이픈이 읽히지 않았다: ' + p.k.match(/\S-\S/)[0]);
  }
}

const nS = R.a.reduce((s, a) => s + a.n, 0);
if (bad.length) {
  console.error('data/reading.js  기사 ' + R.a.length + '개 · 문장 ' + nS + '개 — 문제 ' + bad.length + '건\n');
  bad.forEach((b) => console.error('  ' + b));
  process.exit(1);
}
console.log('data/reading.js  기사 ' + R.a.length + '개 · 문장 ' + nS + '개 — 이상 없음');
console.log('  검사: 루비 재조립 · かな 아닌 글자 · 번역 누락 · id 중복 · 원문 주소 · 라이선스 표기');
