// かな 표 생성 → data/kana.js
// 표 배치는 realkana.com 과 같은 열(列) 단위다 — 앱에서 선택 단위가 열이므로 여기서 열 구조를 그대로 넘긴다.
// 한글 표기는 tools/kana2hangul.js 를 쓴다 (단어 카드와 같은 표기법을 써야 앱 안에서 어긋나지 않는다).
const fs = require('fs');
const path = require('path');
const { kanaToHangul } = require('./kana2hangul.js');

// 열 = [[かな, romaji] | null, ...]. null 은 五十音図의 빈칸(や행 i·e 등).
const _ = null;
const col = (...cells) => cells;

const HIRA_BASE = [
  col(['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o']),
  col(['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko']),
  col(['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so']),
  col(['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to']),
  col(['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no']),
  col(['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho']),
  col(['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo']),
  col(['や', 'ya'], _, ['ゆ', 'yu'], _, ['よ', 'yo']),
  col(['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro']),
  col(['わ', 'wa'], _, _, ['を', 'wo'], ['ん', 'n']),
  col(['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go']),
  col(['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo']),
  col(['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do']),
  col(['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo']),
  col(['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po']),
];

const HIRA_YOON = [
  col(['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo']),
  col(['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho']),
  col(['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho']),
  col(['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo']),
  col(['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo']),
  col(['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo']),
  col(['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo']),
  col(['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo']),
  col(['じゃ', 'ja'], ['じゅ', 'ju'], ['じょ', 'jo']),
  col(['ぢゃ', 'ja'], ['ぢゅ', 'ju'], ['ぢょ', 'jo']),
  col(['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo']),
  col(['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo']),
];

// 가타카나 기본·요음은 히라가나 표와 같은 자리에 같은 소리가 오도록 변환만 한다
const HIRA_TO_KATA = (s) => s.replace(/[ぁ-ゔ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toKata = (cols) => cols.map((c) => c.map((cell) => (cell ? [HIRA_TO_KATA(cell[0]), cell[1]] : _)));

// 외래어 확장. 五十音図에 없는 소리라 열이 드문드문 비어 있다 (realkana 확장표와 같은 모양).
const KATA_EXT = [
  col(_, _, _, ['イェ', 'ye'], _),
  col(_, ['ウィ', 'wi'], _, ['ウェ', 'we'], ['ウォ', 'wo']),
  col(['ヴァ', 'va'], ['ヴィ', 'vi'], ['ヴ', 'vu'], ['ヴェ', 've'], ['ヴォ', 'vo']),
  col(['ヴャ', 'vya'], _, ['ヴュ', 'vyu'], _, ['ヴョ', 'vyo']),
  col(_, _, _, ['シェ', 'she'], _),
  col(_, _, _, ['ジェ', 'je'], _),
  col(_, _, _, ['チェ', 'che'], _),
  col(_, ['ティ', 'ti'], ['トゥ', 'tu'], _, _),
  col(_, _, ['テュ', 'tyu'], _, _),
  col(_, ['ディ', 'di'], ['ドゥ', 'du'], _, _),
  col(_, _, ['デュ', 'dyu'], _, _),
  col(['ツァ', 'tsa'], ['ツィ', 'tsi'], _, ['ツェ', 'tse'], ['ツォ', 'tso']),
  col(['ファ', 'fa'], ['フィ', 'fi'], _, ['フェ', 'fe'], ['フォ', 'fo']),
  col(_, _, ['フュ', 'fyu'], _, _),
];

/* 입력 판정용 이형 로마자.
   훈령식·일본식으로 배운 사람이 si/ti/tu/hu 로 치는 걸 틀렸다고 하면 드릴이 성립하지 않는다.
   키는 대표 romaji, 값은 추가로 인정할 입력. */
const ALT = {
  shi: ['si'], chi: ['ti'], tsu: ['tu'], fu: ['hu'], ji: ['zi'], zu: ['du'],
  sha: ['sya'], shu: ['syu'], sho: ['syo'],
  cha: ['tya'], chu: ['tyu', 'cyu'], cho: ['tyo'],
  ja: ['jya', 'zya'], ju: ['jyu', 'zyu'], jo: ['jyo', 'zyo'],
  wo: ['o'], n: ['nn'],
  vu: ['bu'], ti: ['thi'], di: ['dhi'], tu: ['twu'], du: ['dwu'],
  she: ['sye'], je: ['jye', 'zye'], che: ['tye'],
  tyu: ['thu'], dyu: ['dhu'],
};
// だ행의 ぢ·づ 는 ざ행과 소리가 같아 romaji 가 겹친다. 입력은 둘 다 받되 표에 적는 대표형은 다르게 둔다.
const ALT_BY_KANA = { 'ぢ': ['di'], 'づ': ['du'], 'ヂ': ['di'], 'ヅ': ['du'], 'ぢゃ': ['dya'], 'ぢゅ': ['dyu'], 'ぢょ': ['dyo'], 'ヂャ': ['dya'], 'ヂュ': ['dyu'], 'ヂョ': ['dyo'] };

const GROUPS = [
  { k: 'hb', s: 'h', n: '히라가나 기본', cols: HIRA_BASE },
  { k: 'hy', s: 'h', n: '히라가나 요음', cols: HIRA_YOON },
  { k: 'kb', s: 'k', n: '가타카나 기본', cols: toKata(HIRA_BASE) },
  { k: 'ky', s: 'k', n: '가타카나 요음', cols: toKata(HIRA_YOON) },
  { k: 'ke', s: 'k', n: '가타카나 확장', cols: KATA_EXT },
];

const items = {};
const out = [];
let n = 0;
for (const g of GROUPS) {
  const cols = g.cols.map((c) => c.map((cell) => {
    if (!cell) return null;
    const [c1, r] = cell;
    if (items[c1]) throw new Error('かな 중복: ' + c1);
    const h = kanaToHangul(c1);
    if (!/^[가-힣]+$/.test(h)) throw new Error('한글 표기 실패: ' + c1 + ' -> ' + h);
    const alt = (ALT[r] || []).concat(ALT_BY_KANA[c1] || []).filter((x) => x !== r);
    items[c1] = { r: r, h: h, g: g.k, s: g.s };
    if (alt.length) items[c1].a = alt.filter((v, i, arr) => arr.indexOf(v) === i);
    n++;
    return c1;
  }));
  out.push({ k: g.k, s: g.s, n: g.n, c: cols });
}

const json = (v) => JSON.stringify(v);
const body = [
  '/* 생성물 - tools/build-kana.js. 직접 고치지 말 것.',
  '   i: かな -> {r 대표 romaji, h 한글 표기, g 그룹, s 스크립트, a 추가로 인정할 입력}',
  '   g: 표 구조. c[열][행] = かな 또는 null(五十音図 빈칸). 선택 단위가 열이라 열 우선이다. */',
  'window.JLPT_KANA = {',
  '  i: {',
  ...Object.keys(items).map((c) => '    ' + json(c) + ': ' + json(items[c]) + ','),
  '  },',
  '  g: [',
  ...out.map((g) => '    {k:' + json(g.k) + ',s:' + json(g.s) + ',n:' + json(g.n) + ',c:' + json(g.c) + '},'),
  '  ]',
  '};',
  '',
].join('\n');

const dest = path.join(__dirname, '..', 'data', 'kana.js');
fs.writeFileSync(dest, body);
const per = out.map((g) => g.n + ' ' + g.c.reduce((a, c) => a + c.filter(Boolean).length, 0) + '자').join(' · ');
console.log('data/kana.js  총 ' + n + '자  (' + per + ')');
console.log('열 수 ' + out.reduce((a, g) => a + g.c.length, 0) + ' · 이형 입력 있는 글자 ' + Object.keys(items).filter((c) => items[c].a).length);
