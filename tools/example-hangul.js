// 예문 한글 발음 생성: 한자 표기(e)와 かな 읽기(ek)를 정렬해 어절 단위로 끊어 한글로 옮긴다.
// 한 덩어리로 붙이면("고카조쿠니요로시쿠오쓰타에쿠다사이") 못 읽으므로 끊는 게 핵심.
const { kanaToHangul } = require('./kana2hangul');

const KANJI = /[一-鿿㐀-䶿々]/;
// 조사 뒤에서 끊되, です/ます 를 で·ま 에서 쪼개지 않도록 뒤에 す 가 오면 끊지 않는다.
// で 는 です 오탐이 커서 제외 (조사 で 는 보통 한자 어절에 붙어 이미 분리됨).
const PARTICLE_BREAK = /(?<=[はがをにとのへもや、。！？])(?![すし])/g;

// e 를 한자런 / 비한자런으로 쪼갠다
function runs(e) {
  const out = [];
  for (const ch of e) {
    const kanji = KANJI.test(ch);
    if (out.length && out.at(-1).kanji === kanji) out.at(-1).s += ch;
    else out.push({ kanji, s: ch });
  }
  return out;
}

// ek 안에서 비한자런을 앵커로 삼아, 앵커 사이 구간을 앞 한자런의 읽기로 본다.
// {r: 한자 읽기, k: 원문 かな}로 나눠 둔다 — 조사 분리는 k 안에서만 해야 안전하다.
// (r 안에서 하면 「ながい」의 が를 조사로 착각해 "나가 / 이데스"로 쪼갠다)
function segment(e, ek) {
  const rs = runs(e);
  const chunks = [];
  let pos = 0;
  let pendingReading = '';

  for (const r of rs) {
    if (r.kanji) continue; // 다음 앵커에서 처리
    const idx = ek.indexOf(r.s, pos);
    if (idx < 0) return null; // 정렬 실패
    if (idx > pos) pendingReading = ek.slice(pos, idx);
    chunks.push({ r: pendingReading, k: r.s });
    pendingReading = '';
    pos = idx + r.s.length;
  }
  if (pos < ek.length) chunks.push({ r: pendingReading, k: ek.slice(pos) });
  else if (pendingReading) chunks.push({ r: pendingReading, k: '' });

  return chunks.filter((c) => c.r || c.k);
}

// 히라가나↔가타카나 경계는 항상 단어 경계다
const SCRIPT_BREAK = /(?<=[ぁ-ん])(?=[ァ-ヶー])|(?<=[ァ-ヶー])(?=[ぁ-ん])/g;

// 어절이 너무 길면 조사 뒤에서 한 번 더 끊는다.
// 조사 분리는 원문 かな(c.k) 안에서만 — 한자 읽기(c.r)에서 하면 「ながい」의 が를 조사로 오인한다.
function refine(chunks) {
  const out = [];
  for (const c of chunks) {
    const pieces = [];
    if ([...(c.r + c.k)].length <= 5) pieces.push(c.r + c.k);
    else {
      const kParts = c.k.split(PARTICLE_BREAK).filter(Boolean);
      pieces.push(c.r + (kParts.shift() || ''), ...kParts);
    }
    for (const p of pieces) out.push(...p.split(SCRIPT_BREAK));
  }
  // 홀로 떨어진 1글자 조사는 앞 어절에 붙인다 (「カメラ / を」 -> 「カメラを」)
  const merged = [];
  for (const c of out.filter(Boolean)) {
    if (merged.length && /^[はがをにでとへもや]$/.test(c)) merged[merged.length - 1] += c;
    else merged.push(c);
  }
  return merged;
}

function exampleHangul(e, ek, opts) {
  if (!ek) return null;
  let chunks = e ? segment(e, ek) : null;
  if (!chunks || !chunks.length) chunks = [{ r: '', k: ek }]; // 정렬 실패 시 통째로
  return refine(chunks).map((c) => kanaToHangul(c, opts)).filter(Boolean).join(' ');
}

module.exports = { exampleHangul };

if (require.main === module) {
  const cases = [
    ['御家族によろしくお伝えください。', 'ごかぞくによろしくおつたえください。'],
    ['毎朝コーヒーを飲みます。', 'まいあさコーヒーをのみます。'],
    ['紙に楕円をきれいに描いた。', 'かみにだえんをきれいにかいた。'],
    ['休み時間に雑談を楽しむ。', 'やすみじかんにざつだんをたのしむ。'],
    ['この問題は難しいです。', 'このもんだいはむずかしいです。'],
    ['彼は「いえ、結構です」と答えた。', 'かれは「いえ、けっこうです」とこたえた。'],
  ];
  for (const [e, ek] of cases) console.log(ek, '\n  ->', exampleHangul(e, ek), '\n');
}
