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

module.exports = { KANJI_KO_FIX, initialSoundLaw };

if (require.main === module) {
  for (const w of ['령수', '려행', '료리', '련습', '락원', '리유', '녀자', '뢰성', '률동', '남자', '수확'])
    console.log(w, '->', initialSoundLaw(w));
}
