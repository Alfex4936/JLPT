// Gemini TTS → assets/audio/read/<기사 id>-<줄 번호>.opus + data/audio.js
//
// **기사 하나가 단위다.** 제목(0번)과 모든 문장을 다 만들거나 아예 안 만든다.
// 절반만 만들면 한 기사 안에서 어떤 줄은 Gemini 목소리, 어떤 줄은 기기 TTS 로 나온다 —
// 화자가 줄마다 바뀌는 건 사람 녹음을 쓰는 realkana 대비 최악의 결과다. 그래서 실패하면
// 그 기사가 만든 파일을 전부 지운다. 앱은 data/audio.js 에 등재된 기사만 음원을 쓴다.
//
// 모델에 넘기는 건 표기가 아니라 검수된 かな 읽기다(제목 tk, 문장 s[].k). 표기를 주면 모델이
// 고유명사를 우리 루비와 다르게 읽어 화면과 소리가 어긋나고, 사용자는 한자를 못 읽어 그걸 못 잡는다.
//
// 실행:
//   GEMINI_API_KEY=... node tools/build-reading-audio.js                 # 없는 기사부터 전부
//   GEMINI_API_KEY=... LIMIT=3 node tools/build-reading-audio.js          # 3기사만 (할당량 아껴서)
//   GEMINI_API_KEY=... ONLY=r44444,r9845 node tools/build-reading-audio.js
//   DRY=1 node tools/build-reading-audio.js
//   MANIFEST=1 node tools/build-reading-audio.js                          # 요청 없이 data/audio.js 만 다시 씀
//
// 무료 등급은 요청 한도가 10이다(`generate_content_free_tier_requests`). 기사 하나가
// 문장 수 + 1 요청을 쓰므로 결제를 붙이지 않으면 기사 한 편도 못 끝낸다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUTDIR ? path.resolve(process.env.OUTDIR) : path.join(ROOT, 'assets', 'audio', 'read');
const MAN = path.join(ROOT, 'data', 'audio.js');
const TMP = path.join(process.env.SCRATCH || require('os').tmpdir(), 'reading-audio-build');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.VOICE || 'Zephyr';      // かな 음원과 같은 화자로 맞춘다
const BITRATE = process.env.BITRATE || '24k';
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = !!process.env.DRY;
const MANIFEST_ONLY = !!process.env.MANIFEST;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function articles() {
  global.window = {};
  require(path.join(ROOT, 'data', 'reading.js'));
  const R = global.window.JLPT_READING;
  if (!R || !R.a) throw new Error('data/reading.js 를 못 읽었다');
  // 0번이 제목, 1번부터 문장. 앱의 artRows() 와 같은 순서여야 한다.
  return R.a.map((a) => ({
    id: a.i,
    title: a.t.map((p) => p[0]).join(''),
    rows: [a.tk].concat(a.s.map((s) => s.k))
  }));
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
  for (let t = 0; t < 4; t++) {
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
      console.log('    오디오 없는 응답 — 재시도 ' + (t + 1));
    } else if (res.status === 429) {
      // 무료 등급 한도다. 기다려도 안 풀리니 바로 포기하고 기사를 되돌린다.
      const t2 = await res.text();
      const free = /free_tier/.test(t2);
      console.log('    HTTP 429 — ' + (free ? '무료 등급 한도. 결제를 붙여야 한다.' : '할당량 초과'));
      return null;
    } else {
      console.log('    HTTP ' + res.status + ' — 재시도 ' + (t + 1));
    }
    await sleep(2000 * (t + 1));
  }
  return null;
}

// 디스크에 완전한 기사만 등재한다 — 앱은 이 목록만 믿는다
function writeManifest(list) {
  const have = {};
  for (const a of list) {
    let ok = true;
    for (let i = 0; i < a.rows.length; i++) {
      if (!fs.existsSync(path.join(OUT, a.id + '-' + i + '.opus'))) { ok = false; break; }
    }
    if (ok) have[a.id] = a.rows.length;
  }
  const ids = Object.keys(have);
  const body = [
    '/* 생성물 - tools/build-reading-audio.js. 직접 고치지 말 것.',
    '   음원이 **전부** 있는 기사만 등재한다. 절반만 있는 기사를 쓰면 한 기사 안에서',
    '   줄마다 화자가 바뀐다 — 그래서 앱은 이 목록에 있는 기사만 음원으로 읽는다. */',
    'window.JLPT_AUDIO = { read: ' + JSON.stringify(have) + ' };',
    ''
  ].join('\n');
  fs.writeFileSync(MAN, body);
  const bytes = fs.existsSync(OUT)
    ? fs.readdirSync(OUT).filter((f) => f.endsWith('.opus')).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0)
    : 0;
  console.log('data/audio.js  기사 ' + ids.length + '/' + list.length + '편 등재 · ' + (bytes / 1024).toFixed(0) + ' KB');
  return ids.length;
}

(async () => {
  const all = articles();
  if (MANIFEST_ONLY) { writeManifest(all); return; }

  let todo = all.filter((a) => !a.rows.every((_, i) => fs.existsSync(path.join(OUT, a.id + '-' + i + '.opus'))));
  if (ONLY.length) todo = todo.filter((a) => ONLY.indexOf(a.id) >= 0);
  if (LIMIT) todo = todo.slice(0, LIMIT);

  const reqs = todo.reduce((n, a) => n + a.rows.length, 0);
  console.log('만들 기사 ' + todo.length + '편 · 요청 ' + reqs + '회 · 음성 ' + VOICE);
  if (DRY) {
    todo.forEach((a) => console.log('  ' + a.id + '  줄 ' + a.rows.length + '  ' + a.title.slice(0, 30)));
    console.log('\nDRY=1 이라 요청하지 않았다.');
    return;
  }
  if (!KEY) { console.error('GEMINI_API_KEY 가 없다.'); process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  let done = 0;
  let stopped = false;
  for (const a of todo) {
    if (stopped) break;
    console.log('[' + (done + 1) + '/' + todo.length + '] ' + a.id + '  줄 ' + a.rows.length + '  ' + a.title.slice(0, 30));
    const written = [];
    let ok = true;
    for (let i = 0; i < a.rows.length; i++) {
      const dst = path.join(OUT, a.id + '-' + i + '.opus');
      if (fs.existsSync(dst)) continue;
      const lead = i === 0
        ? '次の日本語のニュース見出しを、落ち着いた声で自然に読み上げてください。\n'
        : '次の日本語の文を、ニュースを読むように自然に読み上げてください。\n';
      const pcm = await tts(lead + a.rows[i]);
      if (!pcm) { ok = false; break; }
      const wav = path.join(TMP, a.id + '-' + i + '.wav');
      pcmToWav(pcm, wav);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
        '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ac', '1', '-c:a', 'libopus', '-b:a', BITRATE, dst]);
      written.push(dst);
      await sleep(500);
    }
    if (!ok) {
      // 기사 단위로 되돌린다. 반쪽 기사는 남기지 않는다.
      for (const f of written) { try { fs.unlinkSync(f); } catch (e) {} }
      console.log('  ✗ 중단 — 이 기사가 만든 ' + written.length + '개를 지웠다');
      stopped = true;
      break;
    }
    done++;
  }

  const n = writeManifest(all);
  if (stopped) {
    console.log('\n할당량에서 멈췄다. 결제를 붙인 뒤 다시 실행하면 없는 기사부터 이어서 만든다.');
    process.exit(n ? 0 : 1);
  }
})();
