// Gemini TTS → assets/audio/ex/<단어 id>.opus  (단어 카드의 예문)
//
// 단어 음원과 다른 점이 둘이다.
//
// **묶어 자를 수 없다.** 단어는 20개를 한 번에 읽히고 무음으로 갈랐지만 문장은 안 된다 —
// 문장 안의 、 휴지가 문장 사이 쉼과 길이가 겹쳐서 어디가 경계인지 정할 수 없다.
// 그래서 문장 하나가 요청 하나다(읽기 기사 396문장도 396요청이었다). 1,351문장 = 14일.
//
// **파일명이 단어 id 다.** 문장은 파일명이 될 수 없고(길고 구두점이 있다), 해시를 쓰면
// 앱과 빌더가 같은 함수를 계속 맞춰야 한다. w.i 는 9,543항목에서 유일해서 충돌이 구조적으로 없다.
// 같은 문장을 쓰는 항목이 17개 있어 그만큼 중복 생성되지만 1.2% 라 신경 쓸 값이 아니다.
//
// 읽히는 건 `ek`(かな 읽기)다. 한자 표기 `e` 를 넘기면 음성이 읽기를 틀린다 —
// 읽기 기사에서 같은 이유로 かな 를 넘겼다.
//
// 실행:
//   GEMINI_API_KEY=... node tools/build-example-audio.js              # 기본 N5+N4
//   GEMINI_API_KEY=... LEVELS=5,4,3 node tools/build-example-audio.js
//   GEMINI_API_KEY=... LIMIT=5 node tools/build-example-audio.js
//   DRY=1 node tools/build-example-audio.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUTDIR ? path.resolve(process.env.OUTDIR) : path.join(ROOT, 'assets', 'audio', 'ex');
const TMP = path.join(process.env.SCRATCH || require('os').tmpdir(), 'ex-audio-build');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.VOICE || 'Zephyr';      // かな·기사·단어와 같은 화자
const BITRATE = process.env.BITRATE || '24k';
const LEVELS = (process.env.LEVELS || '5,4').split(',').map(Number).filter(Boolean);
const LIMIT = Number(process.env.LIMIT || 0);
const DRY = !!process.env.DRY;
const PACE = Number(process.env.PACE || 6500);    // RPM 10 밑으로. 단어 빌더와 같은 값
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let QUOTA_DAY = 0;

function items() {
  global.window = { JLPT: [] };
  for (const lv of LEVELS) {
    const f = path.join(ROOT, 'data', 'words-n' + lv + '.js');
    if (fs.existsSync(f)) require(f);
  }
  return global.window.JLPT.filter((w) => w.ek).map((w) => ({ id: String(w.i), text: w.ek }));
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
      // 일일 한도면 재시도가 전부 헛되고 그 요청까지 한도에 카운트된다
      const txt = await res.text();
      if (/PerDay/.test(txt)) {
        const m = txt.match(/"retryDelay":\s*"(\d+)s"/);
        QUOTA_DAY = m ? Number(m[1]) : 3600;
        console.log('    일일 한도 소진 — 재시도하지 않는다');
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

(async () => {
  const all = items();
  let todo = all.filter((x) => !fs.existsSync(path.join(OUT, x.id + '.opus')));
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log('예문 N' + LEVELS.join('+N') + ' ' + all.length + '개 중 만들 것 ' + todo.length + '개 · 요청 ' + todo.length + '회 · 음성 ' + VOICE);
  if (DRY) {
    todo.slice(0, 5).forEach((x) => console.log('  ' + x.id + '  ' + x.text));
    if (todo.length > 5) console.log('  … ' + (todo.length - 5) + '개 더');
    console.log('\nDRY=1 이라 요청하지 않았다.');
    return;
  }
  if (!KEY) { console.error('GEMINI_API_KEY 가 없다.'); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let made = 0;
  for (let i = 0; i < todo.length; i++) {
    const x = todo[i];
    console.log('[' + (i + 1) + '/' + todo.length + '] ' + x.id + '  ' + x.text.slice(0, 28));
    const pcm = await tts('次の日本語の文を、自然に読み上げてください。'
      + '書かれている語尾をそのまま読み、言い換えないでください。\n' + x.text);
    if (!pcm) { if (QUOTA_DAY) break; continue; }
    const wav = path.join(TMP, x.id + '.wav');
    pcmToWav(pcm, wav);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
      '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE, path.join(OUT, x.id + '.opus')]);
    fs.unlinkSync(wav);
    made++;
    await sleep(PACE);
  }

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.opus'));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log('\n새로 ' + made + '개 · 총 ' + files.length + '/' + all.length + '개 · ' + (bytes / 1048576).toFixed(1) + ' MB');
  if (QUOTA_DAY) {
    console.log('QUOTA_DAY_SECONDS=' + QUOTA_DAY);
    process.exit(3);
  }
})();
