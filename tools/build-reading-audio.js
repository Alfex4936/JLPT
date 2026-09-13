// Gemini TTS → assets/audio/read/<기사 id>.opus  (읽기 기사 제목)
//
// 제목만 만든다. 읽기 모드에서 자동으로 나는 소리는 제목이고, 본문은 사용자가 문장을 눌렀을 때만
// 난다 — 본문 350문장을 다 뜨면 8~12MB 이고, 문장은 안에 쉼이 있어 덩어리로 잘라낼 수도 없다.
// 본문은 기기 TTS 로 남겨 둔다.
//
// 모델에 넘기는 건 표기가 아니라 **검수된 かな 읽기(tk)** 다. 표기를 주면 모델이 고유명사를
// 우리 루비와 다르게 읽을 수 있고(森繁 를 もりしげる 로 읽는 식), 화면의 루비와 소리가 어긋난다.
// 사용자는 한자를 못 읽으니 그 불일치를 잡을 방법이 없다.
//
// 실행:
//   GEMINI_API_KEY=... node tools/build-reading-audio.js
//   VOICE=Zephyr LIMIT=3 DRY=1 node tools/build-reading-audio.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUTDIR ? path.resolve(process.env.OUTDIR) : path.join(ROOT, 'assets', 'audio', 'read');
const TMP = path.join(process.env.SCRATCH || require('os').tmpdir(), 'reading-audio-build');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.VOICE || 'Zephyr';      // かな 음원과 같은 화자로 맞춘다
const BITRATE = process.env.BITRATE || '24k';
const LIMIT = Number(process.env.LIMIT || 0);
const DRY = !!process.env.DRY;
const FORCE = !!process.env.FORCE;                // 이미 있는 파일도 다시 만든다

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function articles() {
  global.window = {};
  require(path.join(ROOT, 'data', 'reading.js'));
  const R = global.window.JLPT_READING;
  if (!R || !R.a) throw new Error('data/reading.js 를 못 읽었다');
  return R.a.map((a) => ({ id: a.i, tk: a.tk, t: a.t.map((p) => p[0]).join('') }));
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
  for (let t = 0; t < 6; t++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const j = await res.json();
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const audio = parts.find((p) => p.inlineData && /audio/.test(p.inlineData.mimeType || ''));
      if (audio) return Buffer.from(audio.inlineData.data, 'base64');
    }
    // 429 는 할당량이다 — 뒤로 갈수록 길게 쉰다
    const wait = (res.status === 429 ? 6000 : 1500) * (t + 1);
    console.log('  ' + (res.ok ? '오디오 없는 응답' : 'HTTP ' + res.status) + ' — ' + (wait / 1000) + '초 뒤 재시도 ' + (t + 1));
    await sleep(wait);
  }
  return null;
}

(async () => {
  let list = articles();
  if (LIMIT) list = list.slice(0, LIMIT);
  console.log('기사 제목 ' + list.length + '개 · 음성 ' + VOICE + ' · 모델 ' + MODEL);

  if (DRY) {
    list.forEach((a) => console.log('  ' + a.id + '  ' + a.tk.slice(0, 46)));
    console.log('\nDRY=1 이라 요청하지 않았다.');
    return;
  }
  if (!KEY) { console.error('GEMINI_API_KEY 가 없다.'); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let made = 0, skipped = 0;
  const failed = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const dst = path.join(OUT, a.id + '.opus');
    if (!FORCE && fs.existsSync(dst)) { skipped++; continue; }
    console.log('[' + (i + 1) + '/' + list.length + '] ' + a.id + '  ' + a.t.slice(0, 34));
    // 읽기는 かな 로 주고, 뉴스 제목답게 담담히 읽히게 한다
    const pcm = await tts('次の日本語のニュース見出しを、落ち着いた声で自然に読み上げてください。\n' + a.tk);
    if (!pcm) { failed.push(a.id); console.log('  ✗ 실패'); continue; }
    const wav = path.join(TMP, a.id + '.wav');
    pcmToWav(pcm, wav);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
      '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE, dst]);
    made++;
    await sleep(600);
  }

  const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith('.opus')) : [];
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log('\n새로 ' + made + '개 · 건너뜀 ' + skipped + '개 · 총 ' + files.length + '개 · ' + (bytes / 1024).toFixed(0) + ' KB');
  if (failed.length) {
    console.log('실패 ' + failed.length + '개: ' + failed.join(' ') + '\n다시 실행하면 없는 것만 채운다.');
    process.exit(1);
  }
})();
