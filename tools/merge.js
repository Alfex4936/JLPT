// base.json + 번역 결과(out/*.jsonl) -> data/words-n{5..1}.js  (+ 품질 리포트)
const fs = require('fs');
const path = require('path');
const { exampleHangul } = require('./example-hangul');
const { kanaToHangul } = require('./kana2hangul');

const SCRATCH = process.env.SCRATCH || path.join(__dirname, 'cache');
const BUILD = path.join(SCRATCH, 'build');
const OUTDIR = path.join(BUILD, 'out');
const DATA = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

const POS = new Set(['명사', '동사(타)', '동사(자)', 'い형용사', 'な형용사', '부사', '조사', '접속사', '감탄사', '접두사', '접미사', '대명사', '수사', '연체사', '표현']);
const HAS_KANJI = /[一-鿿㐀-䶿]/;

const BASE_JSON = fs.existsSync(path.join(BUILD, 'base.json'))
  ? path.join(BUILD, 'base.json')
  : path.join(__dirname, 'cache', 'base.json'); // 세션 스크래치가 사라져도 재생성 가능하도록 리포에 캐시
const base = new Map(JSON.parse(fs.readFileSync(BASE_JSON, 'utf8')).map((x) => [x.id, x]));
const files = fs.existsSync(OUTDIR) ? fs.readdirSync(OUTDIR).filter((f) => f.endsWith('.jsonl')) : [];

const merged = new Map();
const issues = { badJson: 0, unknownId: 0, noKo: 0, badPos: [], kanjiInEk: 0, noEx: 0, dupe: 0, rejectedFiles: [] };

// id 정합성 검사: 예문에 그 id의 단어(또는 읽기)가 등장해야 한다.
// 에이전트가 id를 1부터 새로 매기면 뜻이 엉뚱한 단어에 붙으므로 파일 단위로 걸러낸다.
function alignment(objs) {
  let hit = 0, tot = 0;
  for (const o of objs) {
    const b = base.get(o.i);
    if (!b) continue;
    tot++;
    const stem = b.w.replace(/[〜~]/g, '').slice(0, 2);
    if ((o.e && (o.e.includes(stem) || o.e.includes(b.w.slice(0, 1)))) ||
        (o.ek && b.k && o.ek.includes(b.k.slice(0, 2)))) hit++;
  }
  return tot ? hit / tot : 0;
}

for (const f of files) {
  const lines = fs.readFileSync(path.join(OUTDIR, f), 'utf8').split('\n').filter((l) => l.trim());
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const score = alignment(parsed);
  if (score < 0.5) {
    issues.rejectedFiles.push(`${f}(${Math.round(score * 100)}%)`);
    continue;
  }
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { issues.badJson++; continue; }
    const b = base.get(o.i);
    if (!b) { issues.unknownId++; continue; }
    if (merged.has(o.i)) { issues.dupe++; continue; }
    const ko = Array.isArray(o.ko) ? o.ko.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
    if (!ko.length) { issues.noKo++; continue; }
    let p = typeof o.p === 'string' ? o.p.trim() : '';
    if (!POS.has(p)) { if (p) issues.badPos.push(p); p = p || '기타'; }
    const e = typeof o.e === 'string' && o.e.trim() ? o.e.trim() : null;
    let ek = typeof o.ek === 'string' && o.ek.trim() ? o.ek.trim() : null;
    const eo = typeof o.eo === 'string' && o.eo.trim() ? o.eo.trim() : null;
    if (!e) issues.noEx++;
    if (ek && HAS_KANJI.test(ek)) { issues.kanjiInEk++; }
    // 한자음이 한국어 뜻과 같은 단어(問題=문제)는 한국인에게 공짜 어휘 → 배지용 플래그.
    // 1음절 한자음은 부분일치로 오탐이 난다(磨く 한자음 '마' ⊂ '연마하다'). 접두 일치만 인정.
    const same = b.hj && ko.some((m) => {
      const s = m.replace(/[\s·,()]/g, '');
      return b.hj.length >= 2 ? s.includes(b.hj) : s.startsWith(b.hj);
    }) ? 1 : 0;
    // 원천 데이터에 「九 / きゅう / く」처럼 복수 읽기·복수 표기가 한 필드에 섞인 항목이 있다.
    // 첫 형태를 대표로 쓰고 나머지는 alt 로 분리 — 안 하면 한글이 '규쿠'가 되고 TTS 가 슬래시를 읽는다.
    const strip = (s) => String(s || '')
      .replace(/\s*\(=[^)]*\)/g, '')      // 「あげる (=やる)」
      .replace(/（[^）]*）/g, '')           // 「（感）」「（no）」 등 원천 데이터의 품사·주석 누출
      .trim();
    const forms = (s) => strip(s).split(/\s*\/\s*|\s{2,}|、/).map((x) => x.trim()).filter(Boolean);
    const wf = forms(b.w), kf = forms(b.k);
    let w = wf[0] || strip(b.w) || b.w;
    const wAlt = wf.slice(1), kAlt = kf.slice(1);

    // 읽기 정규화: 반각 괄호는 벗기고 안의 かな는 살린다(あたたか(い) -> あたたかい).
    // 그래도 かな가 아니면 표기 자체가 かな인 경우 그것을 읽기로 쓴다.
    const PURE_KANA = /^[ぁ-んァ-ヴーゝゞ・]+$/;
    const READING_FIX = { 賛成: 'さんせい' }; // 원천 데이터가 깨진 유일한 항목
    let k = READING_FIX[w] || (kf[0] || '').replace(/[()]/g, '').trim();
    if (!PURE_KANA.test(k)) k = k.replace(/[^ぁ-んァ-ヴーゝゞ・]/g, '');
    if (!PURE_KANA.test(k)) k = PURE_KANA.test(w) ? w : (READING_FIX[w] || k);
    if (!k) k = w;

    // 한글 발음은 두 벌: 표기법(장음 미표기) / 장음 표시(박자 보존)
    const h = kanaToHangul(k);
    const hL = kanaToHangul(k, { long: true });
    const eh = ek ? exampleHangul(e, ek) : null;
    const ehL = ek ? exampleHangul(e, ek, { long: true }) : null;
    merged.set(o.i, {
      i: b.id, lv: b.lv, w, k, h, hj: b.hj, hjp: b.hjp, ko, p, e, ek, eh, eo, en: b.en,
      ...(wAlt.length ? { wAlt } : {}),
      ...(kAlt.length ? { kAlt } : {}),
      ...(hL !== h ? { hL } : {}),
      ...(ehL && ehL !== eh ? { ehL } : {}),
      ...(same ? { same: 1 } : {}),
    });
  }
}

// 표기·읽기 정규화 후 같아진 항목 제거 (낮은 급수 → 작은 id 우선 보존)
const seenPair = new Set();
let collapsed = 0;
for (const v of [...merged.values()].sort((a, b) => a.lv - b.lv || a.i - b.i)) {
  const key = v.w + '|' + v.k;
  if (seenPair.has(key)) { merged.delete(v.i); collapsed++; continue; }
  seenPair.add(key);
}

const byLv = {};
for (const [, v] of merged) (byLv[v.lv] = byLv[v.lv] || []).push(v);

let total = 0;
for (const lv of [5, 4, 3, 2, 1]) {
  const rows = (byLv[lv] || []).sort((a, b) => a.i - b.i);
  const file = path.join(DATA, `words-n${lv}.js`);
  if (!rows.length) { if (fs.existsSync(file) && process.env.PRUNE) fs.unlinkSync(file); continue; }
  const body = rows.map((r) => JSON.stringify(r)).join(',\n');
  fs.writeFileSync(file, `// JLPT N${lv} · ${rows.length}단어 · 자동 생성 (tools/merge.js)\nwindow.JLPT = window.JLPT || [];\nwindow.JLPT.push(...[\n${body}\n]);\n`);
  total += rows.length;
  console.log(`data/words-n${lv}.js  ${rows.length}단어  ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
}

const posCount = {};
for (const [, v] of merged) posCount[v.p] = (posCount[v.p] || 0) + 1;
const sameCount = [...merged.values()].filter((v) => v.same).length;
console.log('총', total, '/ base', base.size, '| 정규화 중복제거', collapsed, '| 한자음=뜻', sameCount);
console.log('품사분포', JSON.stringify(posCount, null, 0));
console.log('이슈', JSON.stringify({ ...issues, badPos: [...new Set(issues.badPos)].slice(0, 10) }));

// 청크별 결손 리포트
const manifest = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
const missing = [];
for (const m of manifest) {
  const ids = fs.readFileSync(path.join(BUILD, 'chunks', m.name + '.tsv'), 'utf8').split('\n')
    .filter((l) => l.trim()).map((l) => Number(l.split('\t')[0]));
  const got = ids.filter((id) => merged.has(id)).length;
  if (got < ids.length) missing.push(`${m.name}:${got}/${ids.length}`);
}
console.log('청크 결손', missing.length ? missing.join(' ') : '없음');
