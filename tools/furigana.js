// 표기 + 전체 かな 읽기 → 루비 조각 [[글자, 읽기|null], ...]
//
// example-hangul.js 의 align() 과 같은 생각이다: かな 로 된 구간은 읽기 안에서 그대로 찾을 수 있으므로
// 그 자리를 앵커로 잡고, 앵커 사이에 남는 かな 를 한자런에 배정한다. 배치 후보를 전부 시도해
// 가장 그럴듯한 배치를 고른다.
//
// 뉴스에는 숫자와 라틴 문자가 널려 있고 그것도 읽기를 받아야 한다(16日 → じゅうろくにち).
// 그래서 '읽기가 필요한 런' 을 한자에서 [한자·숫자·라틴] 으로 넓혔다.
//
// ── 형태소 힌트 ──
// 한자런이 길면 루비가 뭉친다(約7時間運転 전체에 やくななじかんうんてん). 형태소 분석기로 잘게 쪼개면
// 이번엔 어느 かな 가 어느 토큰 것인지 몰라 엉뚱하게 갈린다(関東(かんと)地方(うちほう)).
// 그래서 분석기의 **읽기를 정답이 아니라 힌트로만** 쓴다. 힌트와 정확히 맞는 배치에 큰 가점을 주되,
// 정답 かな 는 어디까지나 넘겨받은 전체 읽기에서 잘라 온다. 분석기가 틀리면(8月→つき) 힌트가
// 안 맞을 뿐이고 배치는 휴리스틱으로 돌아간다 — 틀린 힌트가 틀린 루비를 만들지는 못한다.

const KANA = /[ぁ-ゖァ-ヺー゛゜ゝゞヽヾ]/;
const NEEDS = /[一-鿿㐀-䶿々〆ヶ0-9０-９A-Za-zＡ-Ｚａ-ｚ]/;

const kataToHira = (s) => String(s || '').replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// 읽기가 이런 글자로 시작할 수는 없다. 이 한 줄이 엉뚱한 분할을 대량으로 걷어낸다.
const BAD_HEAD = /^[ぁぃぅぇぉゃゅょっゎんーァィゥェォャュョッヮンヽヾ゛゜]/;

/* 숫자·라틴은 형태소 분석기가 읽기를 주지 않는다. 그래서 후보를 직접 만든다.
   맞히면 그 자리에 고정되고, 틀려도 힌트일 뿐이라 정답 かな 를 망가뜨리지 않는다.
   숫자 자체의 읽기는 규칙적이고, 조수사에 따라 달라지는 부분(7時=しちじ)은 후보를 여러 개 둔다. */
const ONES = ['ゼロ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
const ONES_ALT = { 0: ['れい', 'まる', 'お'], 1: [], 2: [], 3: [], 4: ['し', 'よ'], 5: [], 6: [], 7: ['しち'], 8: [], 9: ['く'] };
function numHints(digits) {
  const n = Number(digits);
  if (!Number.isFinite(n) || digits.length > 4) return [];
  const d = String(n);
  const out = new Set();
  const build = (lastVariant) => {
    let s = '';
    const L = d.length;
    for (let i = 0; i < L; i++) {
      const v = Number(d[i]);
      const place = L - 1 - i;             // 0=일, 1=십, 2=백, 3=천
      const isLast = i === L - 1;
      if (v === 0) continue;
      const one = isLast && lastVariant ? lastVariant : ONES[v];
      if (place === 0) s += one;
      else if (place === 1) s += (v === 1 ? '' : ONES[v]) + 'じゅう';
      else if (place === 2) s += (v === 1 ? '' : v === 3 ? 'さん' : v === 6 ? 'ろっ' : v === 8 ? 'はっ' : ONES[v])
        + (v === 3 ? 'びゃく' : v === 6 || v === 8 ? 'ぴゃく' : 'ひゃく');
      else s += (v === 1 ? '' : v === 3 ? 'さん' : v === 8 ? 'はっ' : ONES[v]) + (v === 3 ? 'ぜん' : 'せん');
    }
    return s;
  };
  out.add(build(null));
  const last = Number(d[d.length - 1]);
  for (const alt of (ONES_ALT[last] || [])) out.add(build(alt));
  if (n === 0) { out.add('ゼロ'); out.add('れい'); out.add('まる'); }
  return [...out].filter(Boolean);
}

const LETTER = { a: 'エー', b: 'ビー', c: 'シー', d: 'ディー', e: 'イー', f: 'エフ', g: 'ジー', h: 'エイチ',
  i: 'アイ', j: 'ジェイ', k: 'ケー', l: 'エル', m: 'エム', n: 'エヌ', o: 'オー', p: 'ピー', q: 'キュー',
  r: 'アール', s: 'エス', t: 'ティー', u: 'ユー', v: 'ブイ', w: 'ダブリュー', x: 'エックス', y: 'ワイ', z: 'ゼット' };
function latinHints(w) {
  const cs = [...w.toLowerCase()];
  if (!cs.every((c) => LETTER[c])) return [];
  const a = cs.map((c) => LETTER[c]).join('');
  const b = cs.map((c) => (c === 'j' ? 'ジェー' : c === 'k' ? 'ケイ' : LETTER[c])).join('');
  return a === b ? [kataToHira(a), a] : [kataToHira(a), a, kataToHira(b), b];
}

// 글자 종류로만 쪼갠 런
function charRuns(s) {
  const out = [];
  for (const ch of String(s)) {
    const need = NEEDS.test(ch);
    const last = out[out.length - 1];
    if (last && last.need === need) last.s += ch;
    else out.push({ s: ch, need: need });
  }
  return out;
}

/* 토큰 하나를 런으로. 送りがな 는 앵커로 두고 한자런에만 힌트를 남긴다.
   見合わせ(みあわせ) -> [見合 힌트 みあ][わせ 앵커] */
function autoHints(s) {
  if (/^[0-9０-９]+$/.test(s)) return numHints(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  if (/^[A-Za-zＡ-Ｚａ-ｚ]+$/.test(s)) return latinHints(s.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return [];
}

function runsOfToken(surface, hint) {
  const pieces = charRuns(surface);
  const h = kataToHira(hint);
  if (!h || pieces.length === 1) {
    return pieces.map((p) => ({ s: p.s, need: p.need, hints: p.need ? (h ? [h] : autoHints(p.s)) : null }));
  }
  // 앞뒤로 표기와 읽기가 똑같은 かな 를 벗겨낸다
  let a = 0;
  while (a < surface.length && a < h.length && surface[a] === h[a] && !NEEDS.test(surface[a])) a++;
  let b = 0;
  while (b < surface.length - a && b < h.length - a &&
         surface[surface.length - 1 - b] === h[h.length - 1 - b] && !NEEDS.test(surface[surface.length - 1 - b])) b++;
  const coreS = surface.slice(a, surface.length - b);
  const coreH = h.slice(a, h.length - b);
  const out = [];
  if (a) out.push({ s: surface.slice(0, a), need: false, hints: null });
  if (coreS) {
    const inner = charRuns(coreS);
    if (inner.length === 1) out.push({ s: coreS, need: inner[0].need, hints: inner[0].need ? (coreH ? [coreH] : autoHints(coreS)) : null });
    else for (const p of inner) out.push({ s: p.s, need: p.need, hints: p.need ? autoHints(p.s) : null });
  }
  if (b) out.push({ s: surface.slice(surface.length - b), need: false, hints: null });
  return out;
}

// 이웃한 앵커끼리는 합친다 (앵커가 잘게 쪼개져 있어도 결과가 같으므로 탐색만 느려진다)
function mergeAnchors(rs) {
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && !last.need && !r.need) last.s += r.s;
    else out.push(r);
  }
  return out;
}

function buildRuns(s, segments) {
  if (!segments || !segments.length) return charRuns(s).map((p) => ({ s: p.s, need: p.need, hints: p.need ? autoHints(p.s) : null }));
  const rs = [];
  for (const g of segments) for (const r of runsOfToken(g.s, g.read)) rs.push(r);
  return mergeAnchors(rs);
}

function span(run) {
  let lo = 0, hi = 0;
  for (const ch of run.s) {
    if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(ch)) { lo += 1; hi += 6; }   // J=ジェー, W=ダブリュー
    else { lo += 1; hi += 5; }                                 // 한자 1~5모라(承る=うけたまわる), 숫자도 비슷
  }
  return { lo: Math.max(1, lo), hi: hi };
}

function cost(run, take) {
  let ideal = 0;
  for (const ch of run.s) ideal += /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]/.test(ch) ? 2.5 : 2;
  let c = Math.abs(take.length - ideal);
  const hs = run.hints;
  if (hs && hs.length) {
    if (hs.indexOf(take) >= 0) c -= 8;              // 힌트와 정확히 일치 = 거의 확실
    else {
      let near = Infinity;
      for (const h of hs) near = Math.min(near, Math.abs(take.length - h.length));
      c += Math.min(2, near * 0.5);
    }
  }
  return c;
}

/* 표기 s 와 전체 かな 읽기 r 을 맞춰 루비 조각을 만든다.
   segments 는 [{s, read}] (형태소 토큰). 없으면 글자 종류로만 쪼갠다.
   맞출 수 없으면 null — 읽기가 표기와 안 맞는다는 뜻이라 그 문장은 버리는 게 맞다. */
function furigana(s, r, segments) {
  const rs = buildRuns(s, segments);
  const read = String(r);
  if (!rs.length) return null;
  if (!rs.some((x) => x.need)) return rs.map((x) => [x.s, null]);

  const spans = rs.map(span);
  const minRest = new Array(rs.length + 1).fill(0);
  for (let i = rs.length - 1; i >= 0; i--) {
    minRest[i] = minRest[i + 1] + (rs[i].need ? spans[i].lo : [...rs[i].s].length);
  }

  let best = null, nodes = 0;
  (function walk(i, pos, acc, picked) {
    if (best && acc >= best.cost) return;
    if (nodes++ > 60000) return;
    if (i === rs.length) {
      if (pos !== read.length) return;
      if (!best || acc < best.cost) best = { cost: acc, picked: picked.slice() };
      return;
    }
    const run = rs[i];
    if (!run.need) {
      if (read.startsWith(run.s, pos)) {
        picked.push(null);
        walk(i + 1, pos + run.s.length, acc, picked);
        picked.pop();
      }
      return;
    }
    const sp = spans[i];
    const room = read.length - pos - minRest[i + 1];
    const hi = Math.min(sp.hi, room);
    // 힌트 길이를 먼저 시도하면 best 가 일찍 좋아져 가지치기가 세진다
    const order = [];
    for (let len = sp.lo; len <= hi; len++) order.push(len);
    if (run.hints && run.hints.length) {
      const want = run.hints[0].length;
      order.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    }
    for (const len of order) {
      const take = read.substr(pos, len);
      if (!take || !KANA.test(take[0]) || BAD_HEAD.test(take)) continue;
      picked.push(take);
      walk(i + 1, pos + len, acc + cost(run, take), picked);
      picked.pop();
    }
  })(0, 0, 0, []);

  if (!best) return null;
  const out = [];
  for (let i = 0; i < rs.length; i++) out.push([rs[i].s, rs[i].need ? best.picked[i] : null]);
  return out;
}

// 루비 조각을 다시 이어 붙이면 원래 읽기가 나와야 한다 (자체 검증용)
function readingOf(parts) {
  return parts.map(([t, r]) => (r == null ? t : r)).join('');
}

// kuromoji 토큰 -> segments
function segmentsFromTokens(tokens) {
  return tokens.map((t) => ({ s: t.surface_form, read: t.reading && t.reading !== '*' ? t.reading : null }));
}

module.exports = { furigana, readingOf, segmentsFromTokens, kataToHira, numHintsFor: numHints };

if (require.main === module) {
  const T = [
    ['毎朝コーヒーを飲みます。', 'まいあさコーヒーをのみます。'],
    ['約7時間運転を見合わせた。', 'やくななじかんうんてんをみあわせた。'],
    ['世界人口が80億人を超えた。', 'せかいじんこうがはちじゅうおくにんをこえた。'],
  ];
  for (const [s, r] of T) {
    const f = furigana(s, r);
    if (!f) { console.log('FAIL', s); continue; }
    console.log(f.map(([t, ru]) => (ru ? `${t}(${ru})` : t)).join(''), readingOf(f) === r ? '' : '  ← 재조립 불일치');
  }
}
