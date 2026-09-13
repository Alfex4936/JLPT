// reading-draft.json + reading-ko.tsv → data/reading.js
//
// 번역이 붙은 문장만 싣는다. 표 잔해·목록 줄은 번역을 비워 두는 것으로 걸러진다.
// 루비는 이미 furigana() 가 만들어 뒀고, 여기서는 재조립 검사를 한 번 더 한다 —
// 루비 조각을 이어 붙인 게 원래 표기·읽기와 다르면 그 문장은 버린다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRAFT = process.env.SCRATCH
  ? path.join(process.env.SCRATCH, 'build', 'review', 'reading-draft.json')
  : path.join(__dirname, 'cache', 'review', 'reading-draft.json');
const KO = path.join(__dirname, 'reading-ko.tsv');
const OUT = path.join(ROOT, 'data', 'reading.js');

// 번역 파일의 기사 키 → 기사 제목에 들어 있는 문자열
const KEYS = {
  'いなべ草競馬': 'いなべ草競馬',
  'くまげら': 'くまげら',
  '火星の水': '火星で水を確認',
  '交通博物館': '交通博物館',
  'ラブライブ投票': 'ラブライブ',
  'ジャスダック障害': 'ジャスダック',
  '高島彩退社': '高島彩',
  '羽田緊急着陸': '羽田空港に緊急着陸',
  '香川県知事選': '香川県知事選',
  'ホルマリン紛失': 'ホルマリン液',
  '東北地震': '東北地方で地震が相次ぐ',
  'クライスラー売却': 'クライスラー社、ダイムラー社の株式を売却',
  '台風5号': '台風第5号、石垣島の南東から接近',
  'アフガンヘリ': 'アフガニスタンでヘリ墜落',
  '横浜銀行強盗': '横浜の銀行で強盗未遂',
  '青梅森林火災': '青梅市の森林火災が鎮火',
  'アンゴラコレラ': 'アンゴラでコレラが流行',
  '鳴子地熱': '地熱発電所で水蒸気が噴出',
  '森繁久弥訃報': '訃報 森繁久弥氏',
  '民主党代表選': '民主党、2票差で新代表',
  '沢尻エリカ結婚': '女優・沢尻エリカさんが結婚へ',
  'ローマ教皇列聖': 'ローマ教皇、5人を列聖',
  '世界人口80億': '世界人口80億人を超える',
  '共通テスト漫画': '大学入学共通テストに懐かしのあの漫画',
  'W杯スペイン': '2010W杯サッカー',
  '東京五輪閉幕': '東京2020オリンピック閉幕',
  '広島被爆市電': '広島・被爆市電が引退',
  'ウニゲノム': 'ウニの全ゲノム配列解読',
  'トゥーランドット': '荒川選手と小泉首相',
  '小平奈緒7連覇': '小平奈緒が7連覇',
  '杉内ノーノー': '巨人・杉内投手',
  '真夏日2006': '日本の日本海側で2006年初の真夏日',
  '排出量取引': '温室効果ガス排出量取引',
  'ドラフト制度': 'ドラフト制度改革問題',
  '台風21号ドリアン': '非常に強い台風21号',
  '能代コンビニ強盗': '秋田・能代署管内でコンビニ強盗',
  'ロンドン五輪開幕': '2012年ロンドンオリンピックが開幕',
  '宮崎トリインフル': '宮崎で鶏が大量死',
  '岡村靖幸初公判': 'ミュージシャンの岡村靖幸被告',
  '清水昇48ホールド': '清水昇投手がプロ野球新記録',
  '中越震度5強': '新潟県中越地方で震度5強',
  'NZ国民党': 'ニュージーランド国民党ブラッシュ党首',
  'ウィキペディア20万': '日本語版ウィキペディアが20万記事',
  '上野サル脱走': '上野動物園の「北限のサル」',
  '成田スカイアクセス': '成田スカイアクセスが開業',
  '銀行合併': '新生銀行とあおぞら銀行が合併へ'
};

const draft = JSON.parse(fs.readFileSync(DRAFT, 'utf8'));
const ko = {};
for (const line of fs.readFileSync(KO, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('«')) continue;
  const [key, idx, text] = line.split('\t');
  if (!key || idx == null || !text) continue;
  (ko[key] = ko[key] || {})[Number(idx)] = text.trim();
}

const surfaceOf = (ruby) => ruby.map(([t]) => t).join('');
const readingOf = (ruby) => ruby.map(([t, r]) => (r == null ? t : r)).join('');

const out = [];
const report = [];
for (const key of Object.keys(KEYS)) {
  const needle = KEYS[key];
  // 제목 조각이 두 기사에 걸리면 조용히 앞쪽을 집어 엉뚱한 기사에 번역이 붙는다 (台風5号 vs 台風第5号)
  const hits = draft.articles.filter((a) => a.title.includes(needle));
  if (hits.length > 1) {
    report.push('제목 조각이 ' + hits.length + '개 기사에 걸린다: ' + key + ' (' + needle + ') — ' + hits.map((a) => a.title).join(' / '));
    continue;
  }
  const art = hits[0];
  if (!art) { report.push('기사 못 찾음: ' + key + ' (' + needle + ')'); continue; }
  const tr = ko[key] || {};

  const title = art.sentsFull[0];
  if (!title.ok) { report.push('제목 정렬 실패로 통째 제외: ' + art.title); continue; }

  const sents = [];
  let dropped = 0;
  for (let i = 1; i < art.sentsFull.length; i++) {
    const x = art.sentsFull[i];
    if (!x.ok) { dropped++; continue; }
    const k = tr[i];
    if (!k) { dropped++; continue; }                 // 번역 없는 줄 = 본문이 아니다
    if (surfaceOf(x.ruby) !== x.s || readingOf(x.ruby) !== x.r) { dropped++; report.push('루비 재조립 불일치: ' + x.s); continue; }
    sents.push({ r: x.ruby, k: x.r, o: k });
  }
  if (sents.length < 3) { report.push('문장이 3개 미만이라 제외: ' + art.title); continue; }

  out.push({
    i: 'r' + art.id,
    t: title.ruby,
    tk: title.r,
    to: tr[0] || '',
    u: art.url,
    d: art.date || '',
    s: sents,
    n: sents.length,
    hard: Math.round(art.unknownRatio * 1000) / 10,
    dropped: dropped
  });
}

out.sort((a, b) => a.hard - b.hard || a.n - b.n);

const json = (v) => JSON.stringify(v);
const body = [
  '/* 생성물 - tools/merge-reading.js. 직접 고치지 말 것.',
  '   출처: ウィキニュース (ja.wikinews.org) · CC BY 4.0 · 기사마다 u 에 원문 주소가 있다.',
  '   s[].r = 루비 조각 [[표기, 읽기|null], ...] · s[].k = 문장 전체 かな 읽기(TTS용) · s[].o = 한국어 */',
  'window.JLPT_READING = {',
  '  src: ' + json({
    name: 'ウィキニュース', site: 'ja.wikinews.org',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
  }) + ',',
  '  a: [',
  ...out.map((a) => '    ' + json(a).replace(/,"dropped":\d+/, '') + ','),
  '  ]',
  '};',
  ''
].join('\n');
fs.writeFileSync(OUT, body);

const nS = out.reduce((s, a) => s + a.n, 0);
const nDrop = out.reduce((s, a) => s + a.dropped, 0);
console.log('data/reading.js  기사 ' + out.length + '개 · 문장 ' + nS + '개 (번역 없거나 정렬 실패로 제외 ' + nDrop + '줄)');
let ruby = 0, coarse = 0;
for (const a of out) for (const s of a.s) for (const [t, r] of s.r) if (r) { ruby++; if ([...t].length >= 3) coarse++; }
console.log('루비 ' + ruby + '개 · 3글자 이상 뭉친 것 ' + coarse + '개 (' + (coarse / ruby * 100).toFixed(1) + '%)');
if (report.length) { console.log('\n보고:'); report.forEach((r) => console.log('  ' + r)); }
