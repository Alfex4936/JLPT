// かな -> 한글 표기 (국립국어원 일본어 표기법 기반)
// か/た행은 어두에서 평음(가/다), 어중·어말에서 격음(카/타). 장모음은 표기하지 않음.

const KATA_TO_HIRA = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// [어두, 어중·어말], vowel
const T = {
  あ: ['아', 'a'], い: ['이', 'i'], う: ['우', 'u'], え: ['에', 'e'], お: ['오', 'o'],
  か: ['가|카', 'a'], き: ['기|키', 'i'], く: ['구|쿠', 'u'], け: ['게|케', 'e'], こ: ['고|코', 'o'],
  が: ['가', 'a'], ぎ: ['기', 'i'], ぐ: ['구', 'u'], げ: ['게', 'e'], ご: ['고', 'o'],
  さ: ['사', 'a'], し: ['시', 'i'], す: ['스', 'u'], せ: ['세', 'e'], そ: ['소', 'o'],
  ざ: ['자', 'a'], じ: ['지', 'i'], ず: ['즈', 'u'], ぜ: ['제', 'e'], ぞ: ['조', 'o'],
  た: ['다|타', 'a'], ち: ['지|치', 'i'], つ: ['쓰', 'u'], て: ['데|테', 'e'], と: ['도|토', 'o'],
  だ: ['다', 'a'], ぢ: ['지', 'i'], づ: ['즈', 'u'], で: ['데', 'e'], ど: ['도', 'o'],
  な: ['나', 'a'], に: ['니', 'i'], ぬ: ['누', 'u'], ね: ['네', 'e'], の: ['노', 'o'],
  は: ['하', 'a'], ひ: ['히', 'i'], ふ: ['후', 'u'], へ: ['헤', 'e'], ほ: ['호', 'o'],
  ば: ['바', 'a'], び: ['비', 'i'], ぶ: ['부', 'u'], べ: ['베', 'e'], ぼ: ['보', 'o'],
  ぱ: ['파', 'a'], ぴ: ['피', 'i'], ぷ: ['푸', 'u'], ぺ: ['페', 'e'], ぽ: ['포', 'o'],
  ま: ['마', 'a'], み: ['미', 'i'], む: ['무', 'u'], め: ['메', 'e'], も: ['모', 'o'],
  や: ['야', 'a'], ゆ: ['유', 'u'], よ: ['요', 'o'],
  ら: ['라', 'a'], り: ['리', 'i'], る: ['루', 'u'], れ: ['레', 'e'], ろ: ['로', 'o'],
  わ: ['와', 'a'], ゐ: ['이', 'i'], ゑ: ['에', 'e'], を: ['오', 'o'],
  ゔ: ['부', 'u'],
};

const DIGRAPH = {
  きゃ: ['갸|캬', 'a'], きゅ: ['규|큐', 'u'], きょ: ['교|쿄', 'o'],
  ぎゃ: ['갸', 'a'], ぎゅ: ['규', 'u'], ぎょ: ['교', 'o'],
  しゃ: ['샤', 'a'], しゅ: ['슈', 'u'], しょ: ['쇼', 'o'], しぇ: ['셰', 'e'],
  じゃ: ['자', 'a'], じゅ: ['주', 'u'], じょ: ['조', 'o'], じぇ: ['제', 'e'],
  ちゃ: ['자|차', 'a'], ちゅ: ['주|추', 'u'], ちょ: ['조|초', 'o'], ちぇ: ['제|체', 'e'],
  にゃ: ['냐', 'a'], にゅ: ['뉴', 'u'], にょ: ['뇨', 'o'],
  ひゃ: ['햐', 'a'], ひゅ: ['휴', 'u'], ひょ: ['효', 'o'],
  びゃ: ['뱌', 'a'], びゅ: ['뷰', 'u'], びょ: ['뵤', 'o'],
  ぴゃ: ['퍄', 'a'], ぴゅ: ['퓨', 'u'], ぴょ: ['표', 'o'],
  みゃ: ['먀', 'a'], みゅ: ['뮤', 'u'], みょ: ['묘', 'o'],
  りゃ: ['랴', 'a'], りゅ: ['류', 'u'], りょ: ['료', 'o'],
  てぃ: ['티', 'i'], でぃ: ['디', 'i'], とぅ: ['투', 'u'], どぅ: ['두', 'u'],
  ふぁ: ['파', 'a'], ふぃ: ['피', 'i'], ふぇ: ['페', 'e'], ふぉ: ['포', 'o'], ふゅ: ['퓨', 'u'],
  うぃ: ['위', 'i'], うぇ: ['웨', 'e'], うぉ: ['워', 'o'],
  つぁ: ['차', 'a'], つぇ: ['체', 'e'], つぉ: ['초', 'o'],
  ゔぁ: ['바', 'a'], ゔぃ: ['비', 'i'], ゔぇ: ['베', 'e'], ゔぉ: ['보', 'o'],
};

const FINAL_N = 4;  // ㄴ
const FINAL_S = 19; // ㅅ

function addFinal(syl, finalIdx) {
  const code = syl.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171 || code % 28 !== 0) return syl; // 이미 받침 있음
  return String.fromCharCode(0xac00 + code + finalIdx);
}

const VOWEL = { a: '아', i: '이', u: '우', e: '에', o: '오' };
// 장음 표시 기호. 모음을 한 글자 더 쓰는 방식(도오쿄오)보다 길이를 눈에 바로 띄게 한다.
// opts.longStyle = 'repeat' 를 주면 모음 반복 방식으로 돌아간다.
const LONG_MARK = '-';

// long: true 면 장모음을 한 글자 더 써서 박자를 살린다 (도쿄 -> 도오쿄오)
function kanaToHangul(kana, opts) {
  const long = !!(opts && opts.long);
  const mark = (opts && opts.longStyle === 'repeat') ? null : LONG_MARK;
  const s = KATA_TO_HIRA(String(kana).trim()).replace(/[・\s]/g, '');
  const out = [];
  let prevVowel = null;
  let i = 0;
  let firstMora = true;

  while (i < s.length) {
    const two = s.slice(i, i + 2);
    const one = s[i];

    if (one === 'ー' || one === '～' || one === '〜') {
      if (long && VOWEL[prevVowel]) out.push(mark || VOWEL[prevVowel]); // コーヒー -> 고-히-
      i += 1;
      continue;
    }
    if (one === 'ん') {
      if (out.length) out[out.length - 1] = addFinal(out[out.length - 1], FINAL_N);
      else out.push('응');
      prevVowel = 'n';
      i += 1;
      firstMora = false;
      continue;
    }
    if (one === 'っ' || one === 'ッ') {
      if (out.length) out[out.length - 1] = addFinal(out[out.length - 1], FINAL_S);
      i += 1;
      firstMora = false;
      continue;
    }

    const entry = DIGRAPH[two] ? { key: two, len: 2, v: DIGRAPH[two] } :
      T[one] ? { key: one, len: 1, v: T[one] } : null;

    if (!entry) { i += 1; continue; } // 한자·기호 등은 건너뜀

    const [pair, vowel] = entry.v;
    // 장모음: 표기법은 표기하지 않음(とうきょう -> 도쿄).
    // long 옵션이면 모음을 한 박 더 적어 박자를 보존한다(とうきょう -> 도오쿄오).
    const isLong =
      (entry.key === 'う' && (prevVowel === 'u' || prevVowel === 'o')) ||
      (entry.key === 'い' && prevVowel === 'i') ||
      (entry.key === 'え' && prevVowel === 'e') ||
      (entry.key === 'お' && prevVowel === 'o');
    if (isLong) {
      if (long && VOWEL[prevVowel]) out.push(mark || VOWEL[prevVowel]);
      i += entry.len;
      continue;
    }

    const forms = pair.split('|');
    out.push(forms.length === 2 ? (firstMora ? forms[0] : forms[1]) : forms[0]);
    prevVowel = vowel;
    firstMora = false;
    i += entry.len;
  }
  return out.join('');
}

module.exports = { kanaToHangul };

if (require.main === module) {
  for (const w of ['おいしい', 'とうきょう', 'がっこう', 'もんだい', 'まいあさ', 'コーヒー', 'せんせい', 'きょうと', 'たべる', 'しんぶん', 'ちょっと', 'ファイル']) {
    console.log(w, '->', kanaToHangul(w));
  }
}
