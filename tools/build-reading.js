// wikinews.json → 문장별 かな 읽기 초안 + 루비 + 검수 파일
//
// 읽기 초안은 kuromoji(형태소 분석기)가 만든다. 그 읽기는 **믿을 수 없다** — 뉴스에서 틀리는 곳이
// 정확히 날짜·고유명사·숫자다(8月→つき, 原木中山→げんぼくちゅうざん, 〜の間→ま).
// 그래서 세 겹으로 막는다:
//   1) FIX 표로 계통적인 오류를 먼저 교정한다 (조수사·날짜·間 …)
//   2) furigana() 가 표기와 읽기를 못 맞추면 그 문장은 버린다 — 읽기가 표기와 안 맞는다는 뜻이다
//   3) 남은 것은 review/*.tsv 로 뽑아 사람(또는 에이전트)이 읽기와 번역을 확정한다
// 사용자는 한자를 못 읽으므로 틀린 루비를 스스로 못 잡는다. 자동 결과를 그대로 싣지 말 것.
//
// 선행: npm i kuromoji  (빌드 전용. 앱에는 안 들어간다)
//   KUROMOJI_DICT=/path/to/node_modules/kuromoji/dict node tools/build-reading.js
const fs = require('fs');
const path = require('path');
const { furigana, readingOf, kataToHira, numHintsFor } = require('./furigana.js');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.SCRATCH
  ? path.join(process.env.SCRATCH, 'build', 'wikinews.json')
  : path.join(__dirname, 'cache', 'wikinews.json');
const REVIEW = process.env.SCRATCH
  ? path.join(process.env.SCRATCH, 'build', 'review')
  : path.join(__dirname, 'cache', 'review');
const WANT = Number(process.env.WANT || 0);     // 0 = 전부

function dictPath() {
  const cands = [
    process.env.KUROMOJI_DICT,
    process.env.SCRATCH && path.join(process.env.SCRATCH, 'node_modules/kuromoji/dict'),
    path.join(ROOT, 'node_modules/kuromoji/dict')
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  console.error('kuromoji 사전을 못 찾았다. npm i kuromoji 한 뒤 KUROMOJI_DICT= 로 경로를 넘겨라.');
  console.error('찾아본 곳:\n  ' + cands.join('\n  '));
  process.exit(1);
}

const KANA_ONLY = /^[ぁ-ゖァ-ヺー゛゜、。「」『』・？！]+$/;
const KATA = /[ァ-ヺー]/;
const DIGITS = /^[0-9０-９][0-9０-９,，]*$/;

const toAscii = (s) => String(s).replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，]/g, '');

/* 숫자 + 조수사는 **함께** 읽어야 한다. 이게 초안이 깨지던 주된 이유다:
   10日 은 とおか 인데 따로 읽으면 じゅう + とおか 가 되고, 9時 는 くじ 인데 きゅう + くじ 가 된다.
   그래서 짝이 맞으면 두 토큰을 하나로 합쳐 읽기를 만들고, 루비도 「10日(とおか)」 한 덩어리가 된다. */
const DAY = { 1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか',
  8: 'ようか', 9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか' };
const NUM = (n, alt) => {
  const h = numHintsFor(String(n));
  if (!h.length) return null;
  if (!alt) return h[0];
  for (const cand of h) if (cand.endsWith(alt)) return cand;
  // 마지막 자리만 바꿔치기 (7 -> しち: なな 를 떼고 しち)
  return h[0].replace(/(なな|よん|きゅう|ゼロ)$/, alt);
};
function numCounter(n, counter) {
  switch (counter) {
    case '日': return DAY[n] || (NUM(n) && NUM(n) + 'にち');
    case '時': return (n === 4 ? 'よ' : n === 7 ? 'しち' : n === 9 ? 'く' : n === 0 ? 'れい' : NUM(n)) + 'じ';
    case '分': {
      const last = n % 10;
      const p = (last === 1 || last === 3 || last === 4 || last === 6 || last === 8 || last === 0) ? 'ぷん' : 'ふん';
      // 促音까지 가야 맞는다 — 16分 은 じゅうろくぷん 이 아니라 じゅうろっぷん 이다
      const head = (n === 4 ? 'よん' : NUM(n))
        .replace(/いち$/, last === 1 ? 'いっ' : 'いち')
        .replace(/ろく$/, last === 6 ? 'ろっ' : 'ろく')
        .replace(/はち$/, last === 8 ? 'はっ' : 'はち')
        .replace(/じゅう$/, last === 0 ? 'じゅっ' : 'じゅう');
      return head + p;
    }
    case '人': return n === 1 ? 'ひとり' : n === 2 ? 'ふたり' : NUM(n) + 'にん';
    case '月': return (n === 4 ? 'し' : n === 7 ? 'しち' : n === 9 ? 'く' : NUM(n)) + 'がつ';
    case '年': return (n === 4 ? 'よ' : NUM(n)) + 'ねん';
    case '円': return (n === 4 ? 'よん' : NUM(n)) + 'えん';
    case '号': return NUM(n) + 'ごう';
    case '番': return NUM(n) + 'ばん';
    case '位': return NUM(n) + 'い';
    case '回': return (n === 1 ? 'いっ' : n === 6 ? 'ろっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + 'かい';
    case '度': return NUM(n) + 'ど';
    case '両': return NUM(n) + 'りょう';
    case '歳': case '才': return (n === 1 ? 'いっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + 'さい';
    case '本': return (n === 1 ? 'いっ' : n === 3 ? 'さんぼ' : n === 6 ? 'ろっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + (n === 3 ? 'ん' : 'ほん').replace(/^ほん$/, n === 1 || n === 6 || n === 8 || n === 10 ? 'ぽん' : 'ほん');
    case '枚': return NUM(n) + 'まい';
    case '個': return (n === 1 ? 'いっ' : n === 6 ? 'ろっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + 'こ';
    case '件': return NUM(n) + 'けん';
    case '台': return NUM(n) + 'だい';
    case '階': return (n === 1 ? 'いっ' : n === 3 ? 'さん' : n === 6 ? 'ろっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + (n === 3 ? 'がい' : 'かい');
    case '冊': return (n === 1 ? 'いっ' : n === 8 ? 'はっ' : n === 10 ? 'じゅっ' : NUM(n)) + 'さつ';
    case '頭': return NUM(n) + 'とう';
    case '羽': return NUM(n) + 'わ';
    case '機': return NUM(n) + 'き';
    case '都': return NUM(n) + 'と';
    case '県': return NUM(n) + 'けん';
    case '億': return NUM(n) + 'おく';
    case '万': return NUM(n) + 'まん';
    case '千': return NUM(n) + 'せん';
    default: return null;
  }
}

const WEEKDAY = { 月: 'げつ', 火: 'か', 水: 'すい', 木: 'もく', 金: 'きん', 土: 'ど', 日: 'にち' };

function fixToken(toks, i) {
  const t = toks[i];
  const s = t.surface_form;
  const prev = i > 0 ? toks[i - 1].surface_form : '';
  const r = kataToHira(t.reading && t.reading !== '*' ? t.reading : '');
  const next = toks[i + 1] ? toks[i + 1].surface_form : '';
  // 「〜の間」은 あいだ. kuromoji 는 문맥 없이 ま 로 붙인다.
  if (s === '間' && prev === 'の' && r === 'ま') return 'あいだ';
  // 괄호에 홀로 든 요일. (月) 은 げつ 인데 kuromoji 는 つき 로, (日) 은 にち 인데 ひ 로 읽는다.
  if (WEEKDAY[s] && /^[(（]$/.test(prev) && /^[)）]$/.test(next)) return WEEKDAY[s];
  // 조사가 뒤에 붙은 他 는 ほか(共同通信他による). 명사가 붙으면 접두사 た 가 맞다(他教会).
  if (s === '他' && r === 'た' && /^(に|の|と|が|は|で|から|より|も)$/.test(next)) return 'ほか';
  return r;
}

/* 검수에서 잡은 고유명사 읽기. 분석기는 지명·인명을 글자 단위로 읽어 틀린다
   (森繁→もりしげる · 高城→たかぎ · 竹富町→たけとみまち · 雲慶院→くもけいいん).
   사용자는 한자를 못 읽으므로 틀린 루비를 스스로 못 잡는다 — 검수에서 걸린 건 전부 여기 적는다.
   키는 토큰 경계와 무관하게 표기 그대로 쓴다. 雲/慶/院 처럼 쪼개져 있어도 이어 붙여 맞춘다. */
const WORDS = [
  ['石垣島', 'いしがきじま'], ['竹富町', 'たけとみちょう'], ['雲慶院', 'うんけいいん'],
  ['中浜町', 'なかはまちょう'], ['森繁', 'もりしげ'], ['高城', 'たかしろ'], ['沢尻', 'さわじり'],
  ['弾き', 'ひき'], ['夫婦善哉', 'めおとぜんざい'], ['NATO', 'ナトー'], ['UH-1', 'ユーエイチワン'],
  ['森重', 'もりしげ'], ['秋田魁新報', 'あきたさきがけしんぽう'],
  ['W杯', 'ワールドカップ'],            // ダブリューはい 가 된다
  ['1-0', 'いちたいゼロ'],              // 스코어. 하이픈이 그대로 박힌다
  ['1日目', 'いちにちめ'],              // 日 의 DAY 표가 ついたちめ 로 만든다
  ['月下旬', 'がつげじゅん'],           // 月下+旬 으로 쪼개져 げっかしゅん 이 된다
  ['一回', 'いっかい'],                 // 한자 숫자라 numCounter 를 안 타고 いちかい 가 된다
  ['沙保里', 'さおり'],                 // いさごほり
  ['獣医師', 'じゅういし'],             // ししいし
  ['清武町', 'きよたけちょう'],         // きよたけまち
  ['中越', 'ちゅうえつ'],               // なかごえ
  ['右投左打', 'みぎなげひだりうち'],   // みぎとうひだりだ
  ['サル山', 'サルやま'],               // サルさん
  ['不忍池', 'しのばずのいけ'],         // ふにんち
  ['柵', 'さく'],                       // しがらみ
  ['行名', 'こうめい']                  // くだりめい
].sort((a, b) => b[0].length - a[0].length);

const SYMBOL = { '%': 'パーセント', '％': 'パーセント', '+': 'プラス' };

// kuromoji 는 「%、」 처럼 기호와 구두점을 한 토큰으로 붙여 내놓는다. 구두점은 그대로 두고 기호만 읽는다.
function symbolRead(s) {
  if (!SYMBOL[s[0]]) return null;
  let out = '';
  for (const ch of s) {
    if (SYMBOL[ch]) out += SYMBOL[ch];
    else if (/[、。]/.test(ch)) out += ch;
    else return null;
  }
  return out;
}

function matchWord(toks, i) {
  for (const [w, read] of WORDS) {
    let j = i, s = '';
    while (j < toks.length && s.length < w.length) s += toks[j++].surface_form;
    if (s === w) return { s: s, read: read, next: j };
  }
  return null;
}

/* 표기의 가타카나는 읽기에서도 가타카나로 남아야 한다 — furigana 가 그 구간을 앵커로 쓴다.
   토큰 전체가 가타카나일 때만 되돌리면 アメリカ合衆国 이 あめりかがっしゅうこく 가 되어 정렬이 깨진다. */
function keepKata(surface, hira) {
  let out = hira, from = 0;
  for (const run of surface.match(/[ァ-ヺー・]+/g) || []) {
    const at = out.indexOf(kataToHira(run), from);
    if (at < 0) continue;
    out = out.slice(0, at) + run + out.slice(at + run.length);
    from = at + run.length;
  }
  return out;
}

// (UTC+9)·(UTC-7) 시차 표기. 하이픈을 따로 두면 읽기에 그대로 박힌다.
function utcRun(toks, i) {
  const s = toks[i].surface_form;
  if (s !== 'UTC' && s !== 'GMT') return null;
  const sign = (toks[i + 1] && toks[i + 1].surface_form) || '';
  const num = toks[i + 2] && toks[i + 2].surface_form;
  if (!/^[+\-−]$/.test(sign) || !num || !DIGITS.test(num)) return null;
  const n = numHintsFor(String(Number(toAscii(num))))[0];
  if (!n) return null;
  const word = s === 'UTC' ? 'ユーティーシー' : 'ジーエムティー';
  return { s: s + sign + num, read: word + (sign === '+' ? 'プラス' : 'マイナス') + n, next: i + 3 };
}

// 8:16 -> はちじじゅうろくふん. 콜론을 앵커로 두면 읽기에 콜론이 박힌다.
function timeRun(toks, i) {
  const c = toks[i + 1], b = toks[i + 2];
  if (!c || c.surface_form !== ':' || !b) return null;
  if (!DIGITS.test(toks[i].surface_form) || !DIGITS.test(b.surface_form)) return null;
  const h = numCounter(Number(toAscii(toks[i].surface_form)), '時');
  const m = numCounter(Number(toAscii(b.surface_form)), '分');
  if (!h || !m) return null;
  return { s: toks[i].surface_form + ':' + b.surface_form, read: h + m, next: i + 3 };
}

/* 자릿점·소수점으로 끊긴 숫자는 한 덩어리로 읽어야 한다. 1,300 의 토큰은 1 / , / 300 이라
   따로 읽으면 いち,さんびゃく 가 되고 자릿점이 그대로 かな 에 박힌다. */
function numRun(toks, i) {
  if (!DIGITS.test(toks[i].surface_form)) return null;
  let s = toks[i].surface_form, j = i + 1;
  while (toks[j] && /^[,，]$/.test(toks[j].surface_form) && toks[j + 1] && DIGITS.test(toks[j + 1].surface_form)) {
    s += toks[j].surface_form + toks[j + 1].surface_form;
    j += 2;
  }
  let dec = '';
  if (toks[j] && /^[.．]$/.test(toks[j].surface_form) && toks[j + 1] && DIGITS.test(toks[j + 1].surface_form)) {
    dec = toAscii(toks[j + 1].surface_form);
    s += toks[j].surface_form + toks[j + 1].surface_form;
    j += 2;
  }
  const int = toAscii(s.split(/[.．]/)[0]);
  const n = Number(int);
  // 앞자리 0 은 자릿수가 아니라 표기다 — 0秒07 은 ゼロびょうゼロなな 이고 ゼロびょうなな 가 아니다
  if (/^0\d/.test(int)) {
    const each = [...int].map((c) => numHintsFor(c)[0]).join('');
    return each ? { s: s, read: each, next: j, n: null } : null;
  }
  const head = Number.isFinite(n) ? numHintsFor(String(n))[0] : null;
  if (!head) return null;
  // 소수점 아래는 한 자씩 읽는다 — 5.614 는 ごてんろくいちよん
  if (dec) return { s: s, read: head + 'てん' + [...dec].map((c) => numHintsFor(c)[0]).join(''), next: j, n: null };
  return { s: s, read: head, next: j, n: n };
}

// 토큰 읽기를 이어 전체 かな 읽기를 만든다. 표기가 가타카나면 가타카나로 둔다(コーヒー).
// segs 는 furigana 에 넘길 세그먼트 — 숫자+조수사를 합쳤으면 여기서도 합쳐야 루비가 맞는다.
function draftReading(toks) {
  let out = '';
  const segs = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const s = t.surface_form;

    const w = matchWord(toks, i);
    if (w) { out += w.read; segs.push({ s: w.s, read: w.read }); i = w.next - 1; continue; }

    const utc = utcRun(toks, i);
    if (utc) { out += utc.read; segs.push({ s: utc.s, read: utc.read }); i = utc.next - 1; continue; }

    const tm = timeRun(toks, i);
    if (tm) { out += tm.read; segs.push({ s: tm.s, read: tm.read }); i = tm.next - 1; continue; }

    // kuromoji 가 「30分」·「2400円」 처럼 숫자와 조수사를 한 토큰으로 내놓기도 한다. 그러면 さんじゅうぶん 이 된다.
    const glued = s.match(/^([0-9０-９][0-9０-９,，]*)(.+)$/);
    if (glued) {
      const gn = Number(toAscii(glued[1]));
      const gr = Number.isFinite(gn) ? numCounter(gn, glued[2]) : null;
      if (gr) { out += gr; segs.push({ s: s, read: gr }); continue; }
    }

    const num = numRun(toks, i);
    if (num) {
      const next = toks[num.next] && toks[num.next].surface_form;
      // kuromoji 가 조수사에 조사를 붙여 한 토큰으로 내놓기도 한다(「分の」) — 그러면 조수사를 못 알아본다
      const split = next && next.length > 1 ? next.match(/^(.)([ぁ-ゖ、。]+)$/) : null;
      const counter = split ? split[1] : next;
      const tail = split ? split[2] : '';
      const joint = (num.n != null && counter) ? numCounter(num.n, counter) : null;
      if (joint) {                                  // 10日 -> とおか (두 토큰을 한 덩어리로)
        out += joint + tail;
        segs.push({ s: num.s + counter, read: joint });
        if (tail) segs.push({ s: tail, read: null });
        i = num.next;
        continue;
      }
      out += num.read;
      segs.push({ s: num.s, read: num.read });
      i = num.next - 1;
      continue;
    }

    const sym = symbolRead(s);
    if (sym) { out += sym; segs.push({ s: s, read: sym }); continue; }

    if (KANA_ONLY.test(s)) { out += s; segs.push({ s: s, read: null }); continue; }

    if (/^[A-Za-zＡ-Ｚａ-ｚ]+$/.test(s)) {           // SF, USGS, P — 분석기가 읽기를 안 준다
      const { latinReading } = module.exports;
      const lr = latinReading(toAscii(s));
      out += lr || s;
      segs.push({ s: s, read: lr });
      continue;
    }

    const r = fixToken(toks, i);
    if (!r) { out += s; segs.push({ s: s, read: null }); continue; }
    const rr = keepKata(s, r);
    out += rr;
    segs.push({ s: s, read: rr });
  }
  return { read: out, segs: segs };
}

const LETTER = { a: 'エー', b: 'ビー', c: 'シー', d: 'ディー', e: 'イー', f: 'エフ', g: 'ジー', h: 'エイチ',
  i: 'アイ', j: 'ジェイ', k: 'ケー', l: 'エル', m: 'エム', n: 'エヌ', o: 'オー', p: 'ピー', q: 'キュー',
  r: 'アール', s: 'エス', t: 'ティー', u: 'ユー', v: 'ブイ', w: 'ダブリュー', x: 'エックス', y: 'ワイ', z: 'ゼット' };
// 단위는 철자로 읽지 않는다. km 은 ケーエム 이 아니라 キロメートル 이다.
const UNIT = { km: 'キロメートル', kg: 'キログラム', cm: 'センチメートル', mm: 'ミリメートル',
  m: 'メートル', g: 'グラム', t: 'トン', l: 'リットル', ml: 'ミリリットル', ha: 'ヘクタール',
  kw: 'キロワット', mw: 'メガワット', db: 'デシベル', hz: 'ヘルツ', hpa: 'ヘクトパスカル' };
/* 약어만 철자로 읽는다(SF -> エスエフ). Durian 같은 낱말을 철자로 읽으면
   ディーユーアールアイエーエヌ 이 되는데 실제 읽기는 ドリアン 이라 아예 틀린다.
   그런 건 읽기를 비워 두면 정렬이 실패해 검수 대상으로 걸러진다. */
module.exports.latinReading = (w) => {
  const raw = String(w);
  const low = raw.toLowerCase();
  if (UNIT[low]) return UNIT[low];
  if (raw.length > 5) return null;
  if (!/^[A-Z]+$/.test(raw)) return null;            // 약어가 아니면 추측하지 않는다
  const cs = [...low];
  if (!cs.every((c) => LETTER[c])) return null;
  return cs.map((c) => LETTER[c]).join('');
};

const kuromoji = require('kuromoji');
kuromoji.builder({ dicPath: dictPath() }).build((err, tokenizer) => {
  if (err) { console.error(err); process.exit(1); }
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const arts = WANT ? src.articles.slice(0, WANT) : src.articles;

  fs.mkdirSync(REVIEW, { recursive: true });
  let total = 0, aligned = 0, failedS = 0;
  const out = [];
  const rows = [];

  for (const a of arts) {
    const sents = [];
    let bad = 0;
    for (const s of [a.title].concat(a.sents)) {
      total++;
      const toks = tokenizer.tokenize(s);
      const { read: draft, segs } = draftReading(toks);
      const ruby = furigana(s, draft, segs);
      if (!ruby || readingOf(ruby) !== draft) { bad++; failedS++; sents.push({ s: s, r: draft, ok: 0 }); continue; }
      aligned++;
      sents.push({ s: s, r: draft, ok: 1, ruby: ruby });
    }
    out.push({ ...a, sentsFull: sents, bad: bad });
    // 검수용: 문장 / 읽기 초안 / 번역(빈칸)
    rows.push('# ' + a.title + '\t' + a.url);
    for (const x of sents) rows.push([x.ok ? '' : 'ALIGN_FAIL', x.s, x.r, ''].join('\t'));
    rows.push('');
  }

  fs.writeFileSync(path.join(REVIEW, 'reading-draft.tsv'), rows.join('\n'));
  fs.writeFileSync(path.join(REVIEW, 'reading-draft.json'), JSON.stringify({ ...src, articles: out }, null, 1));

  console.log('기사 ' + arts.length + '개 · 문장 ' + total + '개(제목 포함)');
  console.log('정렬 성공 ' + aligned + ' / 실패 ' + failedS + '  (' + (aligned / total * 100).toFixed(1) + '%)');
  const clean = out.filter((a) => !a.bad).length;
  console.log('문장 전부 정렬된 기사 ' + clean + '개');
  console.log('\n검수 파일: ' + path.join(REVIEW, 'reading-draft.tsv'));
  console.log('열 = [ALIGN_FAIL 표시] / 문장 / かな 읽기 초안 / 한국어 번역(비어 있음)');
  console.log('읽기 초안은 형태소 분석기 산출물이라 고유명사·조수사에서 틀린다. 확정 전에 반드시 검수할 것.');
});
