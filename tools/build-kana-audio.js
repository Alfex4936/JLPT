// Gemini TTS → assets/audio/<로마자>.opus  (かな 131음)
//
// 왜 한 요청에 여러 음절을 몰아 읽히는가:
// 문서가 3.1 Flash TTS 의 한계로 "Voice inconsistency with prompt instructions" 를 명시한다 —
// 요청마다 목소리가 튈 수 있다. 131개를 따로 요청하면 글자마다 화자가 바뀌고, 그건 사람 녹음을 쓰는
// realkana 대비 최악의 결과다. 한 요청 안에서 이어 읽히면 목소리가 한 결로 나온다.
// 대신 무음으로 잘라야 하는데, 잘린 개수가 기대와 다르면 **그 덩어리를 버리고 멈춘다** —
// 어긋난 오디오가 조용히 덱에 실리면 사용자는 알 방법이 없다(한자도 かな 도 못 읽어 검증할 수 없다).
//
// 실행:
//   GEMINI_API_KEY=... node tools/build-kana-audio.js
//   VOICE=Kore MODEL=gemini-3.1-flash-tts-preview CHUNK=24 node tools/build-kana-audio.js
//   DRY=1 node tools/build-kana-audio.js      # 요청 없이 계획만 출력
//
// 유료 할당량으로 쓸 것. 무료 할당량은 사람이 입출력을 검토하고 학습에 쓴다(약관 Unpaid Services).
// 생성물 라이선스: 구글은 소유권을 주장하지 않는다(Use of Generated Content). CC 표기는 붙이지 말고
// ATTRIBUTION.md 에 "Gemini TTS 로 생성" 으로 출처를 밝힌다 — 3번 항목(Claude 생성물)과 같은 형식이다.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUTDIR ? path.resolve(process.env.OUTDIR) : path.join(ROOT, 'assets', 'audio');
const TMP = path.join(process.env.SCRATCH || require('os').tmpdir(), 'kana-audio-build');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.VOICE || 'Kore';
const CHUNK = Number(process.env.CHUNK || 24);
const DRY = !!process.env.DRY;
const REUSE = !!process.env.REUSE;   // TMP 에 남은 덩어리 wav 를 재요청 없이 다시 쓴다
const BITRATE = process.env.BITRATE || '24k';

/* 읽기가 같은 글자는 파일 하나를 공유한다 — あ 와 ア 는 같은 소리다.
   대표 표기는 히라가나를 쓴다(모델에 넘길 텍스트). 244자 → 131음. */
function kanaList() {
  global.window = {};
  require(path.join(ROOT, 'data', 'kana.js'));
  const K = global.window.JLPT_KANA;
  if (!K || !K.i) throw new Error('data/kana.js 를 못 읽었다');
  const byR = new Map();
  for (const [ch, m] of Object.entries(K.i)) {
    if (!byR.has(m.r)) byR.set(m.r, { r: m.r, say: ch, chars: [] });
    const e = byR.get(m.r);
    e.chars.push(ch);
    // 히라가나가 있으면 그걸 읽힌다 (s:'h' = 히라가나)
    if (m.s === 'h') e.say = ch;
  }
  return [...byR.values()].sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* PCM(24kHz s16le mono) → wav. TTS 응답은 헤더 없는 생 PCM 이다. */
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
  // 문서가 경고한다: 드물게 오디오 대신 텍스트 토큰을 돌려주며 500 이 난다. 재시도로 넘긴다.
  for (let t = 0; t < 5; t++) {
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
      console.log('  오디오가 없는 응답 — 재시도 ' + (t + 1));
    } else {
      console.log('  HTTP ' + res.status + ' — 재시도 ' + (t + 1));
    }
    await sleep(1500 * (t + 1));
  }
  throw new Error('TTS 실패 (재시도 5회 소진)');
}

/* 무음 경계를 찾아 소리 구간 목록으로.
   ffmpeg 은 silencedetect 결과를 stderr 로 뱉는다. execFileSync 는 성공하면 stderr 를 돌려주지 않아서
   로그가 비고 구간이 통째로 하나가 됐다 — spawnSync 로 항상 stderr 를 받는다. */
function segments(wav, minSilence = 0.12, thresh = '-40dB') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af',
    'silencedetect=noise=' + thresh + ':d=' + minSilence, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const dur = Number(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());

  // 시작과 끝을 따로 모은다 — 파일이 무음으로 끝나면 마지막 silence_end 가 없다
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const segs = [];
  let pos = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - pos > 0.08) segs.push([pos, starts[i]]);
    pos = ends[i] != null ? ends[i] : dur;
  }
  if (dur - pos > 0.08) segs.push([pos, dur]);
  return segs;
}

(async () => {
  const list = kanaList();
  const chunks = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
  console.log('かな ' + list.length + '음 · ' + chunks.length + '요청 (덩어리당 ' + CHUNK + ') · 음성 ' + VOICE + ' · 모델 ' + MODEL);

  if (DRY) {
    chunks.forEach((c, i) => console.log('  ' + (i + 1) + ': ' + c.map((x) => x.say).join(' ')));
    console.log('\nDRY=1 이라 요청하지 않았다. GEMINI_API_KEY 를 주고 다시 실행할 것.');
    return;
  }
  if (!KEY) { console.error('GEMINI_API_KEY 가 없다.'); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let made = 0;
  const failed = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    /* 한 글자씩 또박또박, 사이를 충분히 벌리게 지시한다. 사이가 짧으면 무음 분할이 실패한다.
       읽을 대상만 주고 설명을 섞지 않는다 — 모델이 지시문까지 읽어 버리는 일이 있다. */
    const text = '日本語の仮名を一つずつ、間に一秒の休みを置いて、はっきりと発音してください。'
      + '読み上げるのは次の' + chunk.length + '個の仮名だけです。\n' + chunk.map((x) => x.say).join('、');
    console.log('[' + (ci + 1) + '/' + chunks.length + '] ' + chunk.map((x) => x.say).join(' '));
    const wav = path.join(TMP, 'chunk' + ci + '.wav');
    if (REUSE && fs.existsSync(wav)) console.log('  받아 둔 wav 재사용');
    else pcmToWav(await tts(text), wav);

    const segs = segments(wav);
    if (segs.length !== chunk.length) {
      console.log('  ✗ 구간 ' + segs.length + '개인데 글자는 ' + chunk.length + '개 — 이 덩어리는 버린다');
      failed.push({ ci: ci, want: chunk.length, got: segs.length, chars: chunk.map((x) => x.say).join(' ') });
      continue;
    }
    for (let i = 0; i < chunk.length; i++) {
      const [s, e] = segs[i];
      const dst = path.join(OUT, chunk[i].r + '.opus');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
        '-ss', String(Math.max(0, s - 0.04)), '-to', String(e + 0.04),
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE, dst]);
      made++;
    }
    await sleep(400);
  }

  const bytes = fs.readdirSync(OUT).filter((f) => f.endsWith('.opus'))
    .reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log('\n' + made + '/' + list.length + '음 생성 · ' + (bytes / 1024).toFixed(0) + ' KB');
  if (failed.length) {
    console.log('\n분할 실패 ' + failed.length + '덩어리 — CHUNK 를 줄이거나 다시 실행할 것:');
    failed.forEach((f) => console.log('  덩어리 ' + (f.ci + 1) + ': 구간 ' + f.got + '/' + f.want + '  ' + f.chars));
    process.exit(1);
  }
})();
