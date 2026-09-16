// Gemini TTS → assets/audio/word/<かな 읽기>.opus  (단어 덱 + 한자 모드 대표 단어)
//
// 한자 모드는 한자를 읽지 않는다 — 한 글자는 읽기를 정할 수 없어서(日 = ニチ? ひ?) 대표 단어를 읽는다.
// 그 대표 단어 읽기는 단어 덱 읽기에 100% 포함돼 있다. 그래서 이 스크립트 하나로 두 모드가 같이 붙는다.
//
// **한 요청에 여러 단어를 몰아 읽히고 무음으로 자른다.** 8,017개를 따로 요청하면 8,017회인데
// 20개씩 묶으면 약 400회다 — 속도도 429 위험도 20분의 1이다. 경계를 못 가리면 그 덩어리를
// 버린다(어긋난 음원은 사용자가 한자를 못 읽어 확인할 방법이 없다). 어떻게 가르는지는 sliceWords 를 볼 것.
//
// 파일명은 읽기(かな) 그 자체다. 그래서 매니페스트가 없다 — 앱이 w.k 로 경로를 만들고,
// 없으면 onerror 로 기기 TTS 로 떨어진다. 기사 음원과 달리 단어는 서로 독립이라
// 절반만 있어도 문제가 없다(한 카드 안에서 화자가 섞이지 않는다).
//
// 실행:
//   GEMINI_API_KEY=... node tools/build-word-audio.js                  # 한자 대표 단어부터 전부
//   GEMINI_API_KEY=... SCOPE=kanji node tools/build-word-audio.js       # 한자 예시만 (3,718)
//   GEMINI_API_KEY=... LIMIT=10 node tools/build-word-audio.js          # 덩어리 10개만
//   DRY=1 node tools/build-word-audio.js
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUTDIR ? path.resolve(process.env.OUTDIR) : path.join(ROOT, 'assets', 'audio', 'word');
const TMP = path.join(process.env.SCRATCH || require('os').tmpdir(), 'word-audio-build');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.VOICE || 'Zephyr';      // かな·기사 음원과 같은 화자
const BITRATE = process.env.BITRATE || '24k';
const CHUNK = Number(process.env.CHUNK || 20);
const LIMIT = Number(process.env.LIMIT || 0);
const SCOPE = process.env.SCOPE || 'all';         // all | kanji
const DRY = !!process.env.DRY;

/* 요청 간격. Gemini 3.1 Flash TTS 는 RPM 10 · RPD 100 이다(콘솔 확인).
   400ms 로 쏘면 분당 150요청이라 대부분 즉시 429를 맞고, 그 재시도까지 RPD 에 카운트돼
   하루 한도를 두 배로 태운다(실측: RPD 206/100). 6.5초면 분당 9요청으로 RPM 밑에 머문다. */
const PACE = Number(process.env.PACE || 6500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let QUOTA_DAY = 0;   // 일일 한도에 걸렸을 때 서버가 알려준 대기 초. 0 이면 안 걸린 것

/* 한자 모드가 쓰는 단어를 먼저 만든다 — 그게 이 작업의 목적이고, 중간에 멈춰도 값어치가 남는다.
   그다음 나머지 단어 덱. 읽기(かな)가 같은 단어는 파일 하나를 공유한다. */
function wordList() {
  global.window = { JLPT_KANJI: [] };
  require(path.join(ROOT, 'data', 'kanji.js'));
  const K = global.window.JLPT_KANJI;
  const prio = [];
  const seen = new Set();
  const add = (r) => { if (r && !seen.has(r)) { seen.add(r); prio.push(r); } };
  for (let i = 0; i < 3; i++) for (const k of K) if (k.ex && k.ex[i]) add(k.ex[i][1]);
  if (SCOPE === 'kanji') return prio;

  global.window = { JLPT: [] };
  for (const lv of [5, 4, 3, 2, 1]) {
    const f = path.join(ROOT, 'data', 'words-n' + lv + '.js');
    if (fs.existsSync(f)) require(f);
  }
  for (const w of global.window.JLPT) add(w.k || w.w);
  return prio;
}

function pcmToWav(pcm, file, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

async function tts(text) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  const body = {
    contents: [{ parts: [{ text: text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } }
    }
  };
  for (let t = 0; t < 5; t++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const j = await res.json();
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const a = parts.find((p) => p.inlineData && /audio/.test(p.inlineData.mimeType || ''));
      if (a) return Buffer.from(a.inlineData.data, 'base64');
      console.log('    오디오 없는 응답 — 재시도 ' + (t + 1));
    } else if (res.status === 429) {
      /* 일일 한도면 재시도가 전부 헛되고 그 요청까지 한도에 카운트된다. 분당 한도만 기다린다. */
      const body = await res.text();
      if (/PerDay/.test(body)) {
        const m = body.match(/"retryDelay":\s*"(\d+)s"/);
        QUOTA_DAY = m ? Number(m[1]) : 3600;
        console.log('    일일 한도 소진 — 재시도하지 않는다 (' + Math.round(QUOTA_DAY / 60) + '분 뒤 리셋)');
        return null;
      }
      const wait = [60, 120, 240, 480][t] || 480;
      console.log('    HTTP 429 — ' + wait + '초 대기 후 재시도 ' + (t + 1));
      await sleep(wait * 1000);
      continue;
    } else {
      console.log('    HTTP ' + res.status + ' — 재시도 ' + (t + 1));
    }
    await sleep(2000 * (t + 1));
  }
  return null;
}

/* 단어 경계를 고른다. 무음마다 자르면 안 된다 — 촉음 っ 은 단어 안의 진짜 무음이라
   がっこう 하나가 두 구간으로 갈린다. 실측: 덩어리 37개 중 20개가 21~22구간으로 나와
   버려졌고, 요청 절반이 그렇게 샜다.
   그래서 무음을 다 찾은 뒤 **긴 것 n-1 개만** 경계로 쓰고, 앞뒤 무음은 잘라낸다.
   검증: 옛 방식이 성공한 17덩어리에서 20구간 중 19개가 경계까지 완전히 같았다(남은 1개는
   선행 무음 0.14초를 이 방식이 더 잘라낸 차이). 성공 덩어리는 17 → 35 로 올랐다.
   ffmpeg 은 silencedetect 를 stderr 로 뱉고 execFileSync 는 성공 시 그걸 안 준다 — spawnSync 로 받는다. */
function sliceWords(wav, n, minSilence = 0.12, thresh = '-40dB') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af',
    'silencedetect=noise=' + thresh + ':d=' + minSilence, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const dur = Number(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));

  let head = 0, tail = dur;
  const inner = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], e = ends[i] != null ? ends[i] : dur;
    if (s <= 0.05) head = Math.max(head, e);
    else if (e >= dur - 0.05) tail = Math.min(tail, s);
    else inner.push([s, e]);
  }
  if (inner.length < n - 1) return null;

  const cuts = inner.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, n - 1)
    .sort((a, b) => a[0] - b[0]);
  const segs = [];
  let pos = head;
  for (const [s, e] of cuts) { segs.push([pos, s]); pos = e; }
  segs.push([pos, tail]);
  // 0.15초보다 짧은 단어는 없다. 나오면 경계를 잘못 고른 것이라 이 덩어리를 버린다
  return segs.some(([s, e]) => e - s < 0.15) ? null : segs;
}

(async () => {
  const all = wordList();
  const todo = all.filter((r) => !fs.existsSync(path.join(OUT, r + '.opus')));
  let chunks = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  if (LIMIT) chunks = chunks.slice(0, LIMIT);

  console.log('단어 ' + all.length + '개 중 만들 것 ' + todo.length + '개 · ' + chunks.length + '요청 (덩어리당 ' + CHUNK + ') · 음성 ' + VOICE);
  if (DRY) {
    chunks.slice(0, 3).forEach((c, i) => console.log('  ' + (i + 1) + ': ' + c.join(' ')));
    if (chunks.length > 3) console.log('  … ' + (chunks.length - 3) + '덩어리 더');
    console.log('\nDRY=1 이라 요청하지 않았다.');
    return;
  }
  if (!KEY) { console.error('GEMINI_API_KEY 가 없다.'); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let made = 0;
  const failed = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const text = '日本語の単語を一つずつ、間に一秒の休みを置いて、はっきりと読み上げてください。'
      + '読み上げるのは次の' + chunk.length + '語だけです。\n' + chunk.join('、');
    console.log('[' + (ci + 1) + '/' + chunks.length + '] ' + chunk.slice(0, 6).join(' ') + ' …');
    const pcm = await tts(text);
    if (!pcm) {
      failed.push(ci);
      if (QUOTA_DAY) break;    // 남은 덩어리를 돌면 전부 429 고, 그 요청까지 내일 몫을 깎는다
      console.log('  ✗ 응답 실패');
      continue;
    }
    const wav = path.join(TMP, 'c' + ci + '.wav');
    pcmToWav(pcm, wav);
    const segs = sliceWords(wav, chunk.length);
    if (!segs) {
      console.log('  ✗ 단어 ' + chunk.length + '개의 경계를 못 가렸다 — 이 덩어리는 버린다');
      failed.push(ci);
      continue;
    }
    for (let i = 0; i < chunk.length; i++) {
      const [s, e] = segs[i];
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
        '-ss', String(Math.max(0, s - 0.04)), '-to', String(e + 0.04),
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE,
        path.join(OUT, chunk[i] + '.opus')]);
      made++;
    }
    // 성공한 덩어리 wav 는 버린다 — 덩어리당 2.5MB 라 전체를 돌리면 460MB 가 쌓인다.
    // 실패한 것만 남겨 둔다. 경계를 왜 못 가렸는지 그 wav 없이는 못 본다.
    fs.unlinkSync(wav);
    await sleep(PACE);
  }

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.opus'));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log('\n새로 ' + made + '개 · 총 ' + files.length + '/' + all.length + '개 · ' + (bytes / 1048576).toFixed(1) + ' MB');
  if (failed.length) console.log('실패 덩어리 ' + failed.length + '개 — 다시 실행하면 없는 것만 채운다.');
  if (QUOTA_DAY) {
    // 드라이버가 이 줄을 읽어 리셋까지 잔다.
    console.log('QUOTA_DAY_SECONDS=' + QUOTA_DAY);
    process.exit(3);
  }
})();
