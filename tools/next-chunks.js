// 아직 번역 안 된 청크 이름 출력 (id 기준 커버리지 검사)
const fs = require('fs');
const path = require('path');
const BUILD = path.join(process.env.SCRATCH, 'build');
const OUTDIR = path.join(BUILD, 'out');

const done = new Set();
if (fs.existsSync(OUTDIR)) {
  for (const f of fs.readdirSync(OUTDIR).filter((x) => x.endsWith('.jsonl'))) {
    for (const l of fs.readFileSync(path.join(OUTDIR, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { done.add(JSON.parse(l).i); } catch {}
    }
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
const pending = [];
for (const m of manifest) {
  const ids = fs.readFileSync(path.join(BUILD, 'chunks', m.name + '.tsv'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => Number(l.split('\t')[0]));
  const got = ids.filter((id) => done.has(id)).length;
  if (got < ids.length) pending.push({ name: m.name, level: m.level, need: ids.length - got, total: ids.length });
}
console.log('완료 id', done.size, '| 미완 청크', pending.length);
console.log(pending.map((p) => p.name).join(' '));
if (process.env.LEVELS) {
  const want = process.env.LEVELS.split(',').map(Number);
  console.log('필터:', pending.filter((p) => want.includes(p.level)).map((p) => p.name).join(' '));
}
