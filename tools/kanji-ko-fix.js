// KANJIDIC2 에 korean_h 가 없는 한자를 메운다.
// 주로 신자체(新字体)로, 구자체에만 한국 한자음이 달려 있는 경우다. 예: 収 ← 收(수).
// 비어 있으면 카드에 「収?」 처럼 물음표가 뜨고, 그 단어는 한자음(hj) 전체를 잃는다.
// 새 단어를 넣은 뒤 hjp 에 ? 가 보이면 여기에 추가할 것.
const KANJI_KO_FIX = {
  収: '수', // 구자체 收
};

/* 두음법칙 — 한자음을 한국어 단어 표기에 맞춘다.
   KANJIDIC2 는 글자 단위 음(領=령, 旅=려, 理=리)을 주지만, 한국어 단어에서는 어두에서 바뀐다:
   領収 령수→영수, 旅行 려행→여행, 料理 료리→요리, 練習 련습→연습, 樂園 락원→낙원.
   적용 안 하면 배지(한자음=한국어)가 대량으로 안 붙는다.
   단어의 첫 음절에만 적용한다 (글자별 한자음 hjp 는 사전형 그대로 둔다). */
const Y_MEDIALS = new Set([2, 3, 6, 7, 12, 17, 19, 20]); // ㅑㅒㅕㅖㅛㅠㅢㅣ
const CHO_R = 5, CHO_N = 2, CHO_IEUNG = 11;

function initialSoundLaw(word) {
  if (!word) return word;
  const code = word.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return word;
  const cho = Math.floor(code / 588);
  const jung = Math.floor((code % 588) / 28);
  const jong = code % 28;
  let next = cho;
  if (cho === CHO_R) next = Y_MEDIALS.has(jung) ? CHO_IEUNG : CHO_N;      // 려→여, 라→나
  else if (cho === CHO_N && Y_MEDIALS.has(jung)) next = CHO_IEUNG;         // 녀→여, 니→이
  if (next === cho) return word;
  return String.fromCharCode(0xac00 + (next * 588) + (jung * 28) + jong) + word.slice(1);
}

/* 원천 어휘 목록(tanos.co.uk 유래)의 잘못된 읽기 교정.
   전부 그 카드의 예문이 옳은 읽기를 쓰고 있어서 잡아낸 것들이다 — 예문은 맞고 읽기 필드가 틀렸다.
   사용자는 한자를 못 읽으므로 이 필드가 틀리면 かな·한글·TTS 가 한꺼번에 틀린 발음을 가르친다.
   검증: 각 카드의 ek 와 대조 + 표준 표기 확인. */
const READING_FIX = {
  賛成: 'さんせい',   // 원천 데이터가 깨져 있었음 (Uӣ[い)
  伝言: 'でんごん',   // つてごと
  梯子: 'はしご',     // ていし
  夜行: 'やこう',     // やぎょう
  傷: 'きず',         // しょう (음독은 복합어에서만)
  他人: 'たにん',     // あだびと
  真心: 'まごころ',   // まこころ — 연탁
  日付: 'ひづけ',     // かづけ (N3 쪽은 이미 ひづけ)
  途中: 'とちゅう',   // つちゅう (N4 쪽은 이미 とちゅう)
  施行: 'しこう',     // しぎょう
  人目: 'ひとめ',     // じんもく
  反る: 'そる',       // かえる
  難い: 'がたい',     // かたい (…しがたい)
  昼間: 'ひるま',     // ちゅうかん — 中間의 읽기였다
  真実: 'しんじつ',   // さな — 존재하지 않는 낱말
  一定: 'いってい',   // いちじょう — 一条의 읽기
  乗客: 'じょうきゃく', // じょうかく
  灰皿: 'はいざら',   // はいさら — 연탁 누락
  三日月: 'みかづき', // みかずき — づ/ず 혼동
  桟橋: 'さんばし',   // さんきょう
  愛憎: 'あいぞう',   // あいにく — 生憎(あいにく)와 혼동
  一人: 'ひとり',     // いちにん — 「一人当たり」는 항상 ひとりあたり
  二人: 'ふたり',     // ににん — 「二人分」은 항상 ふたりぶん
};

// 외래어는 가타카나로 남아야 한다. 표기(e)에 가타카나가 그대로 있으므로 읽기(ek)를 복원할 수 있다.
// 예문에서: 「ボールをうまくキャッチした」의 ek 가 「ぼーるをうまくきゃっちした」로 와 있었다.
// 표제어에서: 「アドレス帳」의 읽기가 「あどれすちょう」, 「コピー用紙」가 「こぴいようし」로 와 있었다.
// 장음 부호는 원천에 따라 ー/い/お 로 갈리므로 그 자리만 느슨하게 맞춘다.
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function restoreKatakana(e, ek) {
  if (!e || !ek) return ek;
  for (const run of e.match(/[ァ-ヴ][ァ-ヴー]*/g) || []) {
    if (ek.includes(run)) continue;
    const hira = run.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    if (hira === run) continue;
    if (ek.includes(hira)) { ek = ek.replace(hira, run); continue; }
    const loose = new RegExp([...hira].map((c) => (c === 'ー' ? '[ーあいうえお]' : ESC(c))).join(''));
    const m = ek.match(loose);
    if (m) ek = ek.replace(m[0], run);
  }
  return ek;
}

module.exports = { KANJI_KO_FIX, initialSoundLaw, READING_FIX, restoreKatakana };

if (require.main === module) {
  for (const w of ['령수', '려행', '료리', '련습', '락원', '리유', '녀자', '뢰성', '률동', '남자', '수확'])
    console.log(w, '->', initialSoundLaw(w));
}
