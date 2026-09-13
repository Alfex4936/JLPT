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
// 429 는 자주 난다. 실측으로는 영구 한도가 아니라 창(window)이라 몇 분 뒤 같은 키로 다시 200 이 온다 —
// 그래서 429 는 최대 8분까지 기다리며 재시도한다. 한 번 포기하면 그 기사가 만든 파일을 전부 되돌리므로
// (반쪽 기사를 남기지 않으려고) 곧바로 포기하면 396요청짜리 작업이 첫 스로틀에서 끝나 버린다.
// 그래도 멈추면 다시 실행하면 된다 — 없는 기사부터 이어서 만든다.
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
const CHECK = !!process.env.CHECK;        // 요청 없이 이미 만든 파일만 점검

/* 요청 간격. Gemini 3.1 Flash TTS 는 RPM 10 · RPD 100 이다(콘솔 확인).
   400ms 로 쏘면 분당 150요청이라 대부분 즉시 429를 맞고, 그 재시도까지 RPD 에 카운트돼
   하루 한도를 두 배로 태운다(실측: RPD 206/100). 6.5초면 분당 9요청으로 RPM 밑에 머문다. */
const PACE = Number(process.env.PACE || 6500);
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
      console.log('    오디오 없는 응답 — 재시도 ' + (t + 1));
    } else if (res.status === 429) {
      /* 429 는 대개 분당 창이라 기다리면 풀린다. 실측: 몇 분 뒤 같은 키로 200 이 돌아왔다.
         그래서 곧바로 포기하지 않고 길게 쉰다 — 한 번 포기하면 기사 전체를 되돌리게 되고,
         396요청짜리 작업이 첫 스로틀에서 멈춰 버린다. */
      const wait = [60, 120, 240, 480][t] || 480;
      console.log('    HTTP 429 — ' + wait + '초 대기 후 재시도 ' + (t + 1) + '/4');
      await sleep(wait * 1000);
      continue;
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

/* 만들어 둔 음원 점검. 커밋 전에 돌린다 — 9MB 를 눈으로 다 들을 수는 없다.
   길이를 かな 글자 수로 나눈 값(모라당 초)이 정상 범위를 벗어나면 생성이 잘렸거나 모델이 딴소리를 한 것이다.
   실측 기준: 통째로 생성한 발화가 모라당 약 0.17초였다. */
function checkAudio(all) {
  const bad = [];
  let n = 0, sec = 0;
  for (const a of all) {
    for (let i = 0; i < a.rows.length; i++) {
      const f = path.join(OUT, a.id + '-' + i + '.opus');
      if (!fs.existsSync(f)) continue;
      const d = Number(execFileSync('ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
      const mora = a.rows[i].length || 1;
      const per = d / mora;
      n++; sec += d;
      const where = a.id + '-' + i + '  ' + mora + '모라 ' + d.toFixed(2) + 's (모라당 ' + per.toFixed(3) + 's)';
      if (!d || d < 0.4) bad.push('너무 짧다: ' + where);
      else if (per < 0.09) bad.push('말이 빠르거나 잘렸다: ' + where);
      else if (per > 0.40) bad.push('너무 길다(딴소리 의심): ' + where);
      if (fs.statSync(f).size < 400) bad.push('파일이 거의 비었다: ' + where);
    }
  }
  console.log('점검 ' + n + '개 · 총 ' + (sec / 60).toFixed(1) + '분 · 이상 ' + bad.length + '건');
  bad.forEach((b) => console.log('  ' + b));
  return bad.length;
}

(async () => {
  const all = articles();
  if (CHECK) { process.exit(checkAudio(all) ? 1 : 0); }
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
      await sleep(PACE);
    }
    if (!ok) {
      /* 만든 줄은 남긴다. 반쪽 기사가 노출될 걱정은 없다 — data/audio.js 가 모든 줄이 있는 기사만
         등재하고 앱은 그 목록만 믿는다. 예전에는 여기서 되돌렸는데, 할당량이 빡빡한 상황에서는
         다음 시도가 같은 줄을 다시 만들게 되어 손해였다(실측: 4줄을 만들고 되돌려 4요청을 버렸다).
         이미 있는 파일은 건너뛰므로 재실행하면 없는 줄만 채운다. */
      console.log('  ✗ 중단 — 만든 ' + written.length + '개는 남긴다 (재실행하면 이어서 채운다)');
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
