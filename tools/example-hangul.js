// 예문 한글 발음 생성: 한자 표기(e)와 かな 읽기(ek)를 정렬해 어절 단위로 끊어 한글로 옮긴다.
// 한 덩어리로 붙이면("고카조쿠니요로시쿠오쓰타에쿠다사이") 못 읽으므로 끊는 게 핵심.
//
// 끊는 위치는 "근거가 있는 곳"만 쓴다 — 한자/かな 경계, 확인된 조사 뒤, 문자종 변화, 구두점.
// 근거 없이 조사 글자만 보고 끊으면 とても를 と|ても로 쪼개고, 그러면 と가 어중(토)에서
// 어두(도)로 뒤집혀 발음 표기 자체가 틀린다.
const { kanaToHangul } = require('./kana2hangul');

const KANJI = /[一-鿿㐀-䶿々]/;
// 히라가나↔가타카나 경계는 항상 단어 경계다
const SCRIPT_BREAK = /(?<=[ぁ-ん])(?=[ァ-ヶー])|(?<=[ァ-ヶー])(?=[ぁ-ん])/g;
// 조사로 확인된 자리에서의 실제 발음: は=wa, へ=e
const PARTICLE_SOUND = { は: 'わ', へ: 'え' };

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
// 반환: [{ text, breaks:[offset...] }]  — breaks 는 확인된 조사 바로 뒤 위치
// 표제어(k) 바로 뒤에 붙은 は/へ 는 조사다: 「かばんは…」「ケーキは…」
// 한자에 안 붙고 히라가나 사이에 낀 조사는 이 힌트가 없으면 못 잡는다.
function headwordParticles(ek, k) {
  const spots = new Set();
  if (!k || k.length < 2) return spots;
  let from = 0;
  for (;;) {
    const at = ek.indexOf(k, from);
    if (at < 0) break;
    const after = at + k.length;
    if (PARTICLE_SOUND[ek[after]]) spots.add(after);
    from = at + 1;
  }
  return spots;
}

/* かな런(앵커)들을 ek 위에 배치한다.
   앵커 글자가 ek 안에 여러 번 나오므로 한쪽에서 욕심내면 반드시 틀린다:
     왼쪽부터  -> 「母は元気です」(ははは…) 의 は를 첫 번째로 잡아 母를 「は」로 읽는다
     오른쪽부터 -> 「彼の料理の…」 의 첫 の를 두 번째 の로 잡고 그 뒤가 어긋난다
   그래서 후보를 전부 시도하고, 한자 하나당 2모라에 가까운 배치를 고른다. */
function align(rs, ek, word, kana) {
  const anchors = [];
  for (let i = 0; i < rs.length; i++) if (!rs[i].kanji) anchors.push(i);
  const minRest = rs.map(() => 0);
  for (let i = rs.length - 1; i >= 0; i--) {
    minRest[i] = (i + 1 < rs.length ? minRest[i + 1] : 0) + [...rs[i].s].length;
  }
  const kanjiLen = (i) => (i > 0 && rs[i - 1].kanji ? [...rs[i - 1].s].length : 0);
  // 이 카드의 표제어 읽기는 확실히 안다. 그 한자런에 k 가 배정되면 크게 가점 —
  // 「母は元気です」처럼 2모라 기준만으로는 두 배치의 점수가 같아 갈리지 않는다.
  const knownRead = (i, read) => {
    if (!word || !kana || i <= 0 || !rs[i - 1].kanji) return 0;
    const kr = rs[i - 1].s;
    return (word.includes(kr) || kr.includes(word)) && read === kana ? -10 : 0;
  };

  let best = null, nodes = 0;
  (function walk(a, pos, cost, picked) {
    if (nodes++ > 4000) return;                       // 안전장치
    if (a >= anchors.length) {
      const tail = rs.length && rs.at(-1).kanji ? [...rs.at(-1).s].length : 0;
      const rest = ek.length - pos;
      if (tail ? rest < tail || rest > tail * 4 : rest !== 0) return;
      const total = cost + (tail ? Math.abs(rest - tail * 2) : 0);
      if (!best || total < best.cost) best = { cost: total, picked: picked.slice() };
      return;
    }
    const i = anchors[a], s = rs[i].s, kl = kanjiLen(i);
    const limit = ek.length - (minRest[i] - [...s].length) - s.length;
    for (let idx = ek.indexOf(s, pos); idx >= 0 && idx <= limit; idx = ek.indexOf(s, idx + 1)) {
      const readLen = idx - pos;
      if (kl ? readLen < kl || readLen > kl * 4 : readLen !== 0) continue;
      picked.push(idx);
      walk(a + 1, idx + s.length, cost + (kl ? Math.abs(readLen - kl * 2) : 0) + knownRead(i, ek.slice(pos, idx)), picked);
      picked.pop();
    }
  })(0, 0, 0, []);

  return best ? best.picked : null;
}

function segment(e, ek, hint, opts) {
  const rs = runs(e);
  const chunks = [];
  let pos = 0;
  let pendingReading = '';

  const placed = align(rs, ek, opts && opts.w, opts && opts.k);
  if (!placed) return null;
  let a = 0;

  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (r.kanji) continue; // 다음 앵커에서 처리

    const idx = placed[a++];
    if (idx > pos) pendingReading = ek.slice(pos, idx);

    // 조사 판정 — 근거가 되는 위치 세 곳만 인정한다:
    //   1) 한자 읽기 바로 뒤          「紙は」「犬が」
    //   2) 가타카나·구두점 바로 앞    「ホテルは サービス」「では、」  (단어 안에서는 못 나오는 배열)
    //   3) かな런 끝 + 다음이 한자런  「これは 大切」
    const nextKanji = i + 1 < rs.length && rs[i + 1].kanji;
    const sub = [];    // は/へ -> わ/え 로 발음이 바뀌는 자리
    const cut = [];    // 어절이 끊기는 자리 (조사 뒤)
    for (let j = 0; j < r.s.length; j++) {
      const c = r.s[j];
      const nxt = r.s[j + 1];
      const prv = r.s[j - 1];
      const afterKanji = j === 0 && !!pendingReading;
      const beforeKata = nxt && /[ァ-ヶー、。！？]/.test(nxt);
      const afterKata = prv && /[ァ-ヶー]/.test(prv);            // 「ケーキは」
      const runFinalBeforeKanji = j === r.s.length - 1 && nextKanji;
      const hinted = hint && hint.has(idx + j);                   // 표제어 바로 뒤
      const isParticleSpot = afterKanji || beforeKata || afterKata || runFinalBeforeKanji || hinted;
      if (!isParticleSpot) continue;
      if (PARTICLE_SOUND[c]) sub.push(j);
      // 조사 뒤는 단어 경계다 — 끊어야 다음 단어의 첫 모라가 어두(평음)로 표기된다.
      // 안 끊으면 「犬がとても」의 と가 어중(토)으로 나온다.
      // で·と·か·や 는 제외: です/でした/とても/とき 처럼 조사가 아닌 쓰임이 많아 단어를 쪼갠다.
      if (/[はがをにへも]/.test(c)) cut.push(j + 1);
    }
    let k = r.s;
    for (const p of sub) k = k.slice(0, p) + PARTICLE_SOUND[r.s[p]] + k.slice(p + 1);

    const head = pendingReading.length;
    chunks.push({ text: pendingReading + k, breaks: cut.map((p) => head + p) });
    pendingReading = '';
    pos = idx + r.s.length;
  }
  if (pos < ek.length) chunks.push({ text: pendingReading + ek.slice(pos), breaks: [] });
  else if (pendingReading) chunks.push({ text: pendingReading, breaks: [] });

  return chunks.filter((c) => c.text);
}

function splitAt(text, offsets) {
  const cuts = [...new Set(offsets)].filter((n) => n > 0 && n < text.length).sort((a, b) => a - b);
  const out = [];
  let from = 0;
  for (const c of cuts) { out.push(text.slice(from, c)); from = c; }
  out.push(text.slice(from));
  return out.filter(Boolean);
}

function refine(chunks) {
  const out = [];
  for (const c of chunks) {
    for (const piece of splitAt(c.text, c.breaks)) {
      // 구두점 뒤에서 끊고, 히라가나↔가타카나 경계에서 끊는다
      for (const seg of piece.split(/(?<=[、。！？])/)) {
        for (const s of seg.split(SCRIPT_BREAK)) if (s) out.push(s);
      }
    }
  }
  // ん·っ·ー 로 시작하는 어절은 있을 수 없다 — 앞 어절에 붙인다.
  // 안 붙이면 ん이 받침이 아니라 독립 「응」으로 나온다.
  const merged = [];
  for (const s of out) {
    // 문자종 경계 때문에 조사 한 글자만 떨어지는 경우도 앞에 붙인다 (コーヒー / を)
    if (merged.length && (/^[んっッー]/.test(s) || /^[はがをにでとへもや]$/.test(s))) {
      merged[merged.length - 1] += s;
    } else merged.push(s);
  }
  return merged;
}

function exampleHangul(e, ek, opts) {
  if (!ek) return null;
  const hint = headwordParticles(ek, opts && opts.k);
  let chunks = e ? segment(e, ek, hint, opts) : null;
  if (!chunks || !chunks.length) chunks = [{ text: ek, breaks: [] }]; // 정렬 실패 시 통째로
  return refine(chunks).map((c) => kanaToHangul(c, opts)).filter(Boolean).join(' ');
}

module.exports = { exampleHangul };

if (require.main === module) {
  const cases = [
    ['この紙はたてが長いです。', 'このかみはたてがながいです。'],
    ['電車で雑誌を読みました。', 'でんしゃでざっしをよみました。'],
    ['今日はとても暑いです。', 'きょうはとてもあついです。'],
    ['この本は大変面白いです。', 'このほんはたいへんおもしろいです。'],
    ['毎朝コーヒーを飲みます。', 'まいあさコーヒーをのみます。'],
    ['学校へ行きます。', 'がっこうへいきます。'],
    ['母は元気です。', 'はははげんきです。'],
    ['野党が法案に反対している。', 'やとうがほうあんにはんたいしている。'],
    ['御家族によろしくお伝えください。', 'ごかぞくによろしくおつたえください。'],
  ];
  for (const [e, ek] of cases) console.log(ek, '\n  ->', exampleHangul(e, ek));
}
