/* JLPT 낱말 셔플 - vanilla, 오프라인, file:// 동작
   외부 요청 0. 모듈 없음. 현재 카드만 렌더. */
(function () {
  'use strict';

  /* ---------------- 저장소 ---------------- */
  var K_SET = 'jlpt.settings.v1',
      K_FAV = 'jlpt.fav.v1',
      K_VIEW = 'jlpt.views.v1',
      K_POS = 'jlpt.pos.v1',
      K_KCOL = 'jlpt.kana.v1',
      K_KSTAT = 'jlpt.kanastat.v1',
      K_KREC = 'jlpt.kanarec.v1';

  function $(id) { return document.getElementById(id); }
  // HTMLCollection·NodeList 는 배열이 아니다. 칩 묶음을 도는 코드가 스무 군데라 한 번만 쓴다.
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var DEFAULTS = {
    sec: 15, shuffle: true, seed: 1, levels: null, deck: 'all',
    hide: false, hideDelay: 5,
    tts: true, voice: '', vol: 0.9, rate: 1, ttsAuto: true, ttsTwice: false, ttsEx: false, ttsGap: 700,
    showEx: true, showExH: true, longVowel: false, showEn: false, theme: 'dark',
    study: 'all', batchSize: 60, // study: all(기본, 지금까지의 동작) | batch | srs
    tier: 'all', fastSame: false, tsuCh: false, // tier: all | same(한자음=한국어) | diff(한자음 다름) | kana(한자 없음)
    set: 'words', // set: words(기본) | kanji | kana — 단어 외의 카드는 전부 옵션이다
    font: '', // 일본어 글꼴 키. ''=지금까지의 스택, 'random'=かな 카드마다 바꿈
    kanaTries: 3, kanaShowH: true,
    furi: true, koAll: false, rt: 0.62, rtFont: 'kosugi',  // 읽기: 후리가나 표시·번역 기본값·크기(em)·글꼴
    readOne: true                    // 한 문장씩 크게 (기사 전체를 한 화면에 넣으면 루비가 작아진다)
  };
  var S = (function () {
    var saved = lsGet(K_SET, {}) || {}, o = {};
    for (var k in DEFAULTS) o[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULTS[k];
    o.sec = Math.min(60, Math.max(3, Number(o.sec) || 15));
    o.hideDelay = Math.min(30, Math.max(1, Number(o.hideDelay) || 5));
    o.vol = Math.min(1, Math.max(0, Number(o.vol)));
    o.rate = Math.min(1.5, Math.max(0.5, Number(o.rate) || 1));
    if (!Array.isArray(o.levels)) o.levels = null;
    /* 칩으로 고르는 값은 저장된 값이 칩 목록에 없으면 아무것도 안 켜진다 — 되돌아갈 방법이 사라진다.
       칩 값을 바꾼 적이 있으므로(0.58 -> 0.62) 가장 가까운 칩으로 스냅해 준다. */
    var RT_STEPS = [0.52, 0.62, 0.74, 0.88];
    var rt = Number(o.rt) || DEFAULTS.rt, near = RT_STEPS[0];
    for (var i = 1; i < RT_STEPS.length; i++) {
      if (Math.abs(RT_STEPS[i] - rt) < Math.abs(near - rt)) near = RT_STEPS[i];
    }
    o.rt = near;
    if (['kosugi', 'noto', 'yusei', 'dela'].indexOf(o.rtFont) < 0) o.rtFont = DEFAULTS.rtFont;
    return o;
  })();
  var saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { lsSet(K_SET, S); }, 250); }

  var FAV = lsGet(K_FAV, {}) || {};
  var VIEWS = lsGet(K_VIEW, {}) || {};

  /* ---------------- 간격 반복 (Leitner 상자) ----------------
     채점은 어느 모드에서나 기록된다. 복습 모드만 이 스케줄로 덱을 만든다.
     상자별 다음 복습 간격 — 잊어버릴 무렵에 다시 보게 하는 게 목적. */
  var K_SRS = 'jlpt.srs.v1', K_BATCH = 'jlpt.batch.v1';
  var BOX_MS = [10 * 6e4, 864e5, 3 * 864e5, 7 * 864e5, 21 * 864e5, 60 * 864e5];
  var SRS = lsGet(K_SRS, {}) || {};
  var BATCH = lsGet(K_BATCH, null);
  function saveSrs() { lsSet(K_SRS, SRS); }
  function isDue(k) { var r = SRS[k]; return !!r && r.d <= Date.now(); }
  function dueCount() { var n = 0; for (var k in SRS) if (isDue(k)) n++; return n; }
  var dirty = false;
  function flush() { if (!dirty) return; dirty = false; lsSet(K_VIEW, VIEWS); lsSet(K_FAV, FAV); }
  setInterval(flush, 20000); // 단일 인터벌, 누적 없음
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) { flush(); lsSet(K_SET, S); } });

  /* ---------------- 데이터 ----------------
     단어 덱과 한자 덱은 별개 배열이고, 설정(S.set)이 지금 어느 쪽을 쓸지 고른다.
     데이터 파일이 없어도 앱은 그대로 뜬다 (절대 규칙 4).

     덱 파일은 부트에 없다. 시작 화면 한 장을 띄우려고 4.5MB 를 파싱할 이유가 없어서,
     index.html 에는 개수표(manifest)와 かな 만 있고 나머지는 모드에 들어갈 때 온다. */
  var MAN = window.JLPT_N || {};
  var ALL_W = [], ALL_K = [], ALL_R = [], READ = null;

  function ingest() {
    var raw = Array.isArray(window.JLPT) ? window.JLPT : [];
    ALL_W = [];
    for (var r = 0; r < raw.length; r++) {
      var it = raw[r];
      if (!it || typeof it !== 'object' || !it.w || !it.k) continue;
      var lvn = Number(it.lv);
      if (!(lvn >= 1 && lvn <= 5)) continue;
      it.lv = lvn;
      ALL_W.push(it);
    }
    var rawk = Array.isArray(window.JLPT_KANJI) ? window.JLPT_KANJI : [];
    ALL_K = [];
    for (var rk = 0; rk < rawk.length; rk++) {
      var kt = rawk[rk];
      if (!kt || typeof kt !== 'object' || !kt.c) continue;
      var klv = Number(kt.lv);
      if (!(klv >= 1 && klv <= 5)) continue;
      kt.lv = klv; kt.kind = 'k'; kt.w = kt.c;
      ALL_K.push(kt);
    }
    /* 읽기: 기사 한 편이 카드 하나다. 루비는 빌드 때 만들어져 있고 앱은 그리기만 한다. */
    READ = (window.JLPT_READING && Array.isArray(window.JLPT_READING.a)) ? window.JLPT_READING : null;
    ALL_R = READ ? READ.a.slice() : [];
    for (var ir = 0; ir < ALL_R.length; ir++) { ALL_R[ir].kind = 'r'; ALL_R[ir].w = ''; }
  }
  ingest();

  /* かな: 오십음도 표를 열(列) 단위로 켜고 끈다. 한 글자씩 68번 누르게 하지 않는다.
     급수(lv)가 없는 카드라 급수 필터를 타지 않고, 자동 슬라이드 대신 타자 입력으로 넘어간다.
     3KB 뿐이고 시작 화면·글자 고르기 양쪽이 바로 쓰므로 유일하게 부트에 남긴 덱이다. */
  var KANA = (window.JLPT_KANA && window.JLPT_KANA.i && window.JLPT_KANA.g) ? window.JLPT_KANA : null;
  // 음원이 전부 있는 기사 목록. 반쪽 기사를 쓰면 한 기사 안에서 줄마다 화자가 바뀐다.
  var AUD = (window.JLPT_AUDIO && window.JLPT_AUDIO.read) ? window.JLPT_AUDIO.read : {};
  var ALL_N = [];
  if (KANA) {
    for (var gi = 0; gi < KANA.g.length; gi++) {
      var gg = KANA.g[gi];
      for (var ci = 0; ci < gg.c.length; ci++) {
        for (var ri = 0; ri < gg.c[ci].length; ri++) {
          var ch = gg.c[ci][ri], meta = ch && KANA.i[ch];
          if (!meta) continue;
          ALL_N.push({
            kind: 'n', c: ch, w: ch, r: meta.r, h: meta.h, g: gg.k, gn: gg.n,
            col: gg.k + ':' + ci, ans: [meta.r].concat(meta.a || [])
          });
        }
      }
    }
  }

  /* かな 표에서 파생되는 상수. ALL_N 은 부트 이후 변하지 않으므로 한 번만 센다.
     KCOL_N 은 열 하나에 든 글자 수, KGRP_N 은 그룹 전체 글자 수, KANA_ORDER 는 표에 나온 순서다. */
  var KCOL_N = {}, KGRP_N = {}, KANA_ORDER = {};
  for (var ni = 0; ni < ALL_N.length; ni++) {
    var kn0 = ALL_N[ni];
    KCOL_N[kn0.col] = (KCOL_N[kn0.col] || 0) + 1;
    KGRP_N[kn0.g] = (KGRP_N[kn0.g] || 0) + 1;
    KANA_ORDER[kn0.c] = ni;
  }

  /* 개수: 덱이 오기 전에는 개수표를 읽는다. 온 뒤에는 실제 배열이 진실이다 —
     개수표가 낡아도 화면에 보이는 숫자는 덱과 어긋나지 않는다. */
  function sum(o) { var n = 0; for (var k in o) n += o[k]; return n; }
  function nWords() { return ALL_W.length || sum(MAN.words); }
  function nKanji() { return ALL_K.length || sum(MAN.kanji); }
  function nRead() { return ALL_R.length || (MAN.reading || 0); }

  /* ---------------- 덱 불러오기 ----------------
     클래식 script 태그다 — file:// 에서도 동작하고 fetch 를 쓰지 않는다 (절대 규칙 1).
     ?v= 는 index.html 의 데이터 태그와 같은 값이어야 한다. 데이터를 다시 만들면 둘 다 올린다. */
  var DATA_V = '?v=29';
  var WORD_FILES = ['data/words-n5.js', 'data/words-n4.js', 'data/words-n3.js',
                    'data/words-n2.js', 'data/words-n1.js'];
  var got = {}, waiting = {};

  function filesFor(set) {
    if (set === 'kanji') return ['data/kanji.js'];
    if (set === 'reading') return ['data/reading.js'];
    if (set === 'kana') return [];              // 부트에 이미 있다
    return WORD_FILES;
  }
  function loadFiles(files, cb) {
    var pend = [];
    for (var i = 0; i < files.length; i++) if (!got[files[i]]) pend.push(files[i]);
    if (!pend.length) { cb(); return; }
    var left = pend.length;
    function one() { if (--left === 0) cb(); }
    pend.forEach(function (f) {
      if (waiting[f]) { waiting[f].push(one); return; }
      waiting[f] = [one];
      var s = document.createElement('script');
      s.src = f + DATA_V;
      // 없는 파일은 조용히 넘어간다 — 파일 하나만 있어도 앱은 돈다 (절대 규칙 4)
      s.onload = s.onerror = function () {
        got[f] = 1;
        var q = waiting[f]; delete waiting[f];
        q.forEach(function (fn) { fn(); });
      };
      document.head.appendChild(s);
    });
  }
  // 이 모드에 필요한 덱이 다 온 뒤에 cb. 이미 있으면 그 자리에서 부른다(비동기 지연 없음).
  function need(set, cb) {
    var files = filesFor(set), have = true;
    for (var i = 0; i < files.length; i++) if (!got[files[i]]) { have = false; break; }
    if (have) { cb(); return; }
    document.documentElement.dataset.busy = '1';
    loadFiles(files, function () {
      ingest();
      document.documentElement.dataset.busy = '0';
      cb();
    });
  }

  if (!nKanji() && S.set === 'kanji') S.set = 'words';
  if (!nRead() && S.set === 'reading') S.set = 'words';
  if (!ALL_N.length && S.set === 'kana') S.set = 'words';
  function activeSet() {
    return S.set === 'kanji' ? ALL_K : S.set === 'kana' ? ALL_N : S.set === 'reading' ? ALL_R : ALL_W;
  }
  var ALL = activeSet();

  // 선택된 열. 기본은 히라가나 기본 전체 — 처음 들어오자마자 연습이 시작돼야 한다.
  var KCOLS = lsGet(K_KCOL, null), KCOLSET = {};
  if (!Array.isArray(KCOLS) || !KCOLS.length) {
    KCOLS = [];
    if (KANA) for (var kc0 = 0; kc0 < KANA.g[0].c.length; kc0++) KCOLS.push(KANA.g[0].k + ':' + kc0);
  }
  function syncKcols() {
    KCOLSET = {};
    for (var i = 0; i < KCOLS.length; i++) KCOLSET[KCOLS[i]] = 1;
    lsSet(K_KCOL, KCOLS);
  }
  syncKcols();
  var KSTAT = lsGet(K_KSTAT, {}) || {};   // かな -> [정답, 오답]
  /* 바퀴 단위 기록. KSTAT 은 글자별 누적이라 '이번 바퀴를 얼마나 잘했나'가 안 남는다 —
     다 맞힌 바퀴는 토스트 한 번 뜨고 사라졌다. 연속 기록이 드릴을 붙잡아 두는 힘이다. */
  var KREC = lsGet(K_KREC, null) || { n: 0, ok: 0, ng: 0, perfect: 0, streak: 0, bestStreak: 0, best: -1, bestN: 0 };
  // 급수별 개수. 덱이 오기 전에는 개수표를 읽으므로 시작 화면에서도 급수 칩이 제대로 나온다.
  function lvCounts() {
    if (S.set === 'kana' || S.set === 'reading') return {};   // 급수가 없는 덱이다
    if (!ALL.length) return (S.set === 'kanji' ? MAN.kanji : MAN.words) || {};
    var c = {};
    for (var i = 0; i < ALL.length; i++) c[ALL[i].lv] = (c[ALL[i].lv] || 0) + 1;
    return c;
  }
  function levelsOf(counts) {
    var out = [];
    for (var k in counts) if (counts[k]) out.push(Number(k));
    return out.sort(function (a, b) { return b - a; }); // N5 먼저
  }
  var LEVELS = levelsOf(lvCounts());
  // 한자 카드 uid 는 i 가 'k12' 라서 단어 uid('5-12')와 절대 겹치지 않는다 — 즐겨찾기·채점이 섞이면 안 된다.
  // かな 는 급수가 없어 'n-き' 로 키잉한다. 세 덱의 키가 서로 겹치면 안 된다.
  function uid(w) {
    if (w.kind === 'n') return 'n-' + w.c;
    if (w.kind === 'r') return 'r-' + w.i;
    return w.lv + '-' + (w.i != null ? w.i : w.w);
  }
  function useSet(name) {
    S.set = (nKanji() && name === 'kanji') ? 'kanji'
      : (ALL_N.length && name === 'kana') ? 'kana'
      : (nRead() && name === 'reading') ? 'reading' : 'words';
    ALL = activeSet(); LEVELS = levelsOf(lvCounts());
    save();
  }

  /* ---------------- 덱 ---------------- */
  var deck = [], idx = 0;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, seed) {
    var a = arr.slice(), rnd = mulberry32(seed >>> 0);
    for (var i = a.length - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function activeLevels() {
    if (!S.levels || !S.levels.length) return LEVELS.slice();
    var ok = S.levels.filter(function (n) { return LEVELS.indexOf(n) >= 0; });
    return ok.length ? ok : LEVELS.slice();
  }
  /* 한자음 계층 필터
     same: 한자음이 한국어 뜻과 그대로 겹치는 단어 (한국인에게 사실상 공짜)
     diff: 한자는 있는데 한국어 단어와 어긋난 단어 (勉強=면강/공부 — 진짜 외울 구간)
     kana: 한자가 없는 和語 (한국어 도움 0) */
  function tierOk(w) {
    if (S.set !== 'words') return true;   // 한자음 필터는 단어용이다 (한자 한 글자에는 '뜻과 겹친다'가 성립하지 않는다)
    if (S.tier === 'same') return !!w.same;
    if (S.tier === 'diff') return !!w.hj && !w.same;
    if (S.tier === 'kana') return !w.hj;
    return true;
  }
  var TIER_LABEL = { all: '전체', same: '한자음=한국어', diff: '한자음 다름', kana: 'かな 단어' };

  // 배치: 아직 안 외운 것 우선(상자 낮은 순 → 본 횟수 적은 순)으로 batchSize개
  function makeBatch(pool) {
    var ranked = shuffled(pool, S.seed).slice().sort(function (a, b) {
      var ka = uid(a), kb = uid(b);
      var ba = SRS[ka] ? SRS[ka].b + 1 : 0, bb = SRS[kb] ? SRS[kb].b + 1 : 0;
      return ba - bb || (VIEWS[ka] || 0) - (VIEWS[kb] || 0);
    });
    BATCH = { ids: ranked.slice(0, Math.max(5, S.batchSize)).map(uid), made: Date.now() };
    lsSet(K_BATCH, BATCH);
  }

  // 지금 설정으로 고를 수 있는 단어 집합. 배치를 만들 때도 반드시 이걸 써야 한다 —
  // ALL 로 배치를 뽑으면 급수·한자음 필터와 교집합이 작아져 요청한 개수보다 덱이 작아진다.
  function currentPool() {
    var pool;
    if (S.set === 'kana') {
      pool = ALL.filter(function (w) { return KCOLSET[w.col]; });   // 급수 대신 선택한 열이 범위다
    } else if (S.set === 'reading') {
      pool = ALL.slice();                                            // 기사는 급수가 없다
    } else {
      var set = {}; activeLevels().forEach(function (n) { set[n] = 1; });
      pool = ALL.filter(function (w) { return set[w.lv]; });
    }
    if (S.deck === 'fav') pool = pool.filter(function (w) { return FAV[uid(w)]; });
    return pool.filter(tierOk);
  }

  function buildDeck(keepUid) {
    var pool = currentPool();

    // かな 는 배치·복습 스케줄을 쓰지 않는다 — 한 바퀴 안에서 틀린 글자가 다시 나오는 게 스케줄이다.
    if (S.set === 'kana') {
      retryRound = !!(retryList && retryList.length);
      if (retryRound) {
        var want = {}; retryList.forEach(function (c) { want[c] = 1; });
        pool = ALL_N.filter(function (w) { return want[w.c]; });
        retryList = null;
      }
      /* 바퀴마다 새로 섞는다. S.seed 는 저장되는 값이라 그걸 쓰면 새로고침할 때마다 같은 순서가 나오고,
         순서를 외워 버린다. 단어 덱은 이어보기 때문에 S.seed 가 고정이어야 하므로 여기만 따로 뽑는다. */
      deck = S.shuffle ? shuffled(pool, (Math.random() * 4294967295) >>> 0 || 1) : pool.slice();
      idx = 0; elapsed = 0;
      roundN = deck.length; cleared = {}; roundOk = 0; roundNg = 0; roundMiss = {};
      resetDrill(); paint(); focusDrill();
      return;
    }

    if (S.set === 'reading') {
      deck = S.shuffle ? shuffled(pool, S.seed) : pool.slice();
      idx = 0; elapsed = 0; sentIdx = 0;
      if (keepUid) for (var ir = 0; ir < deck.length; ir++) if (uid(deck[ir]) === keepUid) { idx = ir; break; }
      paint();
      return;
    }

    if (S.study === 'srs') {
      pool = pool.filter(function (w) { return isDue(uid(w)); });
    } else if (S.study === 'batch') {
      var ok = BATCH && BATCH.ids && BATCH.ids.length;
      if (ok) {
        var want = {}; BATCH.ids.forEach(function (k) { want[k] = 1; });
        var sub = pool.filter(function (w) { return want[uid(w)]; });
        if (sub.length >= Math.min(5, S.batchSize)) pool = sub; else ok = false;
      }
      if (!ok) { makeBatch(pool); var w2 = {}; BATCH.ids.forEach(function (k) { w2[k] = 1; }); pool = pool.filter(function (w) { return w2[uid(w)]; }); }
    }

    deck = S.shuffle ? shuffled(pool, S.seed)
      : pool.slice().sort(function (a, b) { return (b.lv - a.lv) || ((a.i || 0) - (b.i || 0)); });
    idx = 0;
    if (keepUid) for (var i = 0; i < deck.length; i++) if (uid(deck[i]) === keepUid) { idx = i; break; }
    elapsed = 0;
    paint();
  }

  /* ---------------- DOM ---------------- */
  var card = $('card'), empty = $('empty'), stage = $('stage'),
      cLv = $('cLv'), cPos = $('cPos'), cSeen = $('cSeen'), cKana = $('cKana'), cWord = $('cWord'),
      cHangul = $('cHangul'), cHanja = $('cHanja'), cHanjaV = $('cHanjaV'), cHjp = $('cHjp'), cAlt = $('cAlt'),
      cMeans = $('cMeans'), meanWrap = $('meanWrap'), cEx = $('cEx'), ruleEx = $('ruleEx'),
      cExJ = $('cExJ'), cExK = $('cExK'), cExH = $('cExH'), cPron = $('cPron'), cExO = $('cExO'), cEn = $('cEn'),
      cKex = $('cKex'), cRead = $('cRead'), rule1 = $('rule1'),
      bar = $('bar'), counter = $('counter'), deckinfo = $('deckinfo'),
      panel = $('panel'), help = $('help'), icPlay = $('icPlay'),
      starGlyph = $('starGlyph'), btnFav = $('btnFav'),
      home = $('home'), summary = $('summary'), dock = document.querySelector('.dock'),
      dockrow = document.querySelector('.dockrow'),
      transport = document.querySelector('.transport'), progress = document.querySelector('.progress'),
      cDrill = $('cDrill'), kanaIn = $('kanaIn'), kanaTip = $('kanaTip'),
      kanaAns = $('kanaAns'), kanaAnsR = $('kanaAnsR'), kanaAnsH = $('kanaAnsH'), kanaAnsA = $('kanaAnsA'),
      kanaPick = $('kanaPick'), drillActs = $('drillActs'),
      cArt = $('cArt'), artBody = $('artBody'), artSrc = $('artSrc'), readActs = $('readActs');

  // 노드 풀 (카드 전환 시 재생성 없이 재사용)
  var meanNodes = [];
  for (var m = 0; m < 3; m++) {
    var li = document.createElement('li');
    var em = document.createElement('em'); var sp = document.createElement('span');
    li.appendChild(em); li.appendChild(sp); li.hidden = true;
    cMeans.appendChild(li);
    meanNodes.push({ li: li, num: em, txt: sp });
  }
  var hjpNodes = [];
  for (var q = 0; q < 8; q++) {
    var ii = document.createElement('i');
    var bb = document.createElement('b'); var ss = document.createElement('span');
    ii.appendChild(bb); ii.appendChild(ss); ii.hidden = true;
    cHjp.appendChild(ii);
    hjpNodes.push({ el: ii, k: bb, h: ss });
  }
  // 한자 카드의 예시 단어 3줄. 줄을 클릭하면 그 단어를 읽는다.
  var kexNodes = [];
  for (var kx = 0; kx < 3; kx++) {
    var row = document.createElement('div');
    row.className = 'kex-row'; row.hidden = true;
    row.title = '클릭하면 이 단어 발음';
    var kw = document.createElement('b'), kk = document.createElement('span'),
        kh = document.createElement('span'), ko2 = document.createElement('em');
    kk.className = 'kex-k'; kh.className = 'kex-h';
    row.appendChild(kw); row.appendChild(kk); row.appendChild(kh); row.appendChild(ko2);
    cKex.appendChild(row);
    kexNodes.push({ el: row, w: kw, k: kk, h: kh, o: ko2 });
    (function (nodeIdx) {
      row.onclick = function () {
        var w = current(); if (!w || w.kind !== 'k' || !w.ex[nodeIdx]) return;
        speakOne(w.ex[nodeIdx][1]);
      };
    })(kx);
  }

  var ICON_PLAY = 'M7 4v16l13-8z';
  var ICON_PAUSE = 'M7 4h4v16H7zm6 0h4v16h-4z';
  // 스피커 + 음파 / 스피커 + 사선(음소거)
  var ICON_SOUND = 'M4 9v6h3l5 4V5L7 9H4zm11.5.5a4 4 0 010 5v-5zm1.8-2.3a7 7 0 010 9.6l1.1 1.1a8.5 8.5 0 000-11.8l-1.1 1.1z';
  var ICON_MUTED = 'M4 9v6h3l5 4V5L7 9H4zm14.6 0L17.2 7.6 15 9.8l-2.2-2.2v2.1l1.1 1.1-1.1 1.1v2.1L15 14.2l2.2 2.2 1.4-1.4-2.2-2.2 2.2-2.2-1.4-1.4z';

  /* ---------------- 렌더 ---------------- */
  var revealed = false;
  var screen = 'home';   // home(학습 선택) | study — 부트는 항상 home 이다
  var LV_LABEL = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };
  var HANGUL = /^(.+?)([가-힣]+)$/;
  var SET_LABEL = { words: '단어', kanji: '한자', kana: 'かな' };

  /* ---------------- 일본어 글꼴 ----------------
     같은 글자를 다른 글꼴로도 읽어내야 진짜로 읽는 것이다. 번들 글꼴은 かな 만 담은 서브셋이라
     단어·한자 모드에서 골라도 한자는 스택 뒤쪽(Klee One)이 그린다. */
  var JP_TAIL = '"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif';
  var FONTS = [
    { k: '', n: '기본' },
    { k: 'klee', n: '교과서체', f: '"Klee One"' },
    { k: 'noto', n: '고딕', f: '"Noto Sans JP"' },
    { k: 'kosugi', n: '둥근고딕', f: '"Kosugi Maru"' },
    { k: 'shippori', n: '명조', f: '"Shippori Mincho"' },
    { k: 'kurenaido', n: '손글씨', f: '"Zen Kurenaido"' },
    { k: 'yusei', n: '매직펜', f: '"Yusei Magic"' },
    { k: 'hachi', n: '둥근 팝', f: '"Hachi Maru Pop"' },
    { k: 'dela', n: '굵은 제목', f: '"Dela Gothic One"' },
    { k: 'sysm', n: '시스템 명조', f: '"Hiragino Mincho ProN","Yu Mincho","MS Mincho"', sys: ['Hiragino Mincho ProN', 'Yu Mincho', 'MS Mincho'] },
    { k: 'sysr', n: '시스템 둥근', f: '"Hiragino Maru Gothic ProN","Meiryo"', sys: ['Hiragino Maru Gothic ProN', 'Meiryo'] },
    { k: 'random', n: '무작위' }
  ];
  // 설치돼 있지 않은 시스템 글꼴 타일은 아예 안 보여준다 — 눌러도 아무 변화가 없으면 고장으로 보인다.
  function fontOk(f) {
    if (!f.sys) return true;
    if (!document.fonts || !document.fonts.check) return false;
    for (var i = 0; i < f.sys.length; i++) {
      try { if (document.fonts.check('12px "' + f.sys[i] + '"')) return true; } catch (e) {}
    }
    return false;
  }
  function fontList() { return FONTS.filter(fontOk); }
  function fontBy(k) {
    var l = FONTS;
    for (var i = 0; i < l.length; i++) if (l[i].k === k) return l[i];
    return FONTS[0];
  }
  function applyFont() {
    var f = fontBy(S.font);
    document.documentElement.style.setProperty('--f-sel', f.f ? f.f + ',' : '');
  }
  function kanaFontStack() {
    if (S.font === 'random') {
      var pool = fontList().filter(function (f) { return f.f; });
      var p = pool[(Math.random() * pool.length) | 0];
      return (p ? p.f + ',' : '') + JP_TAIL;
    }
    var f = fontBy(S.font);
    return (f.f ? f.f + ',' : '') + JP_TAIL;
  }

  function paintHome() {
    var nw = nWords(), nk = nKanji(), nr = nRead();
    $('pickNWords').textContent = nw ? nw.toLocaleString('ko-KR') + '개' : '없음';
    $('pickNKanji').textContent = nk ? nk.toLocaleString('ko-KR') + '자' : '없음';
    $('pickNRead').textContent = nr ? nr + '편' : '없음';
    var kn = ALL_N.length ? kanaSelN() : 0;
    $('pickNKana').textContent = ALL_N.length ? (kn ? kn + '자 선택' : '글자 미선택') : '없음';
    each($('pickRows').children, function (b) {
      var n = b.dataset.go === 'kanji' ? nk : b.dataset.go === 'kana' ? ALL_N.length
        : b.dataset.go === 'reading' ? nr : nw;
      b.setAttribute('aria-disabled', n ? 'false' : 'true');
      b.disabled = !n;
    });
    var seen = 0, k;
    for (k in VIEWS) seen++;
    $('homeFoot').textContent = seen ? '지금까지 본 카드 ' + seen.toLocaleString('ko-KR') + '개' : '';
  }

  function current() { return deck.length ? deck[idx] : null; }

  // 표기법은 つ 를 '쓰'로 적는다(쓰나미·마쓰다). 실제 발음은 [tsɯ] 라 '츠'가 더 가깝다는 사람이 많아 옵션.
  // 출력에서 '쓰'는 つ/ツ 에서만 나오므로(kana2hangul 표 참조) 단순 치환이 정확하다.
  function pron(s) { return S.tsuCh && s ? s.replace(/쓰/g, '츠') : s; }

  /* 한자 카드. 단어 카드와 자리를 공유한다:
     큰 글씨 = 한자, 한글 발음 자리 = 훈음(날 일), 배지 = 한국 한자음, 한자별 한자음 줄 = 음독·훈독 쌍.
     예문 자리에는 이 한자를 쓰는 단어 3개를 넣는다 — 이미 단어 카드로 본 것들이라 서로 보강된다. */
  function paintKanji(w) {
    cLv.textContent = LV_LABEL[w.lv] || ('N' + w.lv);
    cPos.textContent = w.st ? w.st + '획' : '';
    var seen = VIEWS[uid(w)] || 0;
    cSeen.textContent = seen ? '본 횟수 ' + seen : '';

    cKana.textContent = '';
    cWord.textContent = w.c;
    cHangul.textContent = w.hun || '';
    if (w.hj) { cHanjaV.textContent = w.hj; cHanja.hidden = false; }
    else cHanja.hidden = true;
    cHanja.classList.remove('is-same');
    cAlt.hidden = true;

    // 음독·훈독을 かな + 한글 쌍으로. 8칸이므로 각각 최대 4개.
    var pairs = [];
    for (var a = 0; a < w.on.length && pairs.length < 4; a++) pairs.push([w.on[a], pron(w.onH[a] || '')]);
    var onCount = pairs.length;
    for (var b2 = 0; b2 < w.kun.length && pairs.length < 8; b2++) pairs.push([w.kun[b2], pron(w.kunH[b2] || '')]);
    for (var i = 0; i < hjpNodes.length; i++) {
      var n = hjpNodes[i];
      if (i < pairs.length) {
        n.k.textContent = pairs[i][0];
        n.h.textContent = pairs[i][1];
        n.el.hidden = false;
        n.el.classList.toggle('is-kun', i >= onCount);
        n.el.classList.toggle('kun-first', i === onCount);
      } else { n.el.hidden = true; n.el.classList.remove('is-kun'); n.el.classList.remove('kun-first'); }
    }
    cHjp.classList.add('k-read');
    cHjp.hidden = !pairs.length;

    var ko = Array.isArray(w.ko) ? w.ko.slice(0, 3) : [];
    for (var j = 0; j < meanNodes.length; j++) {
      var mn = meanNodes[j];
      if (j < ko.length) {
        mn.num.textContent = ko.length > 1 ? String(j + 1) : '';
        mn.num.hidden = ko.length <= 1;
        mn.txt.textContent = ko[j];
        mn.li.hidden = false;
      } else mn.li.hidden = true;
    }
    revealed = !S.hide;
    meanWrap.classList.toggle('masked', !revealed);

    cEx.hidden = true;
    var ex = Array.isArray(w.ex) ? w.ex.slice(0, 3) : [];
    ruleEx.hidden = !ex.length;
    cKex.hidden = !ex.length;
    for (var e = 0; e < kexNodes.length; e++) {
      var kn = kexNodes[e];
      if (e < ex.length) {
        kn.w.textContent = ex[e][0];
        kn.k.textContent = ex[e][1];
        kn.h.textContent = pron(ex[e][2] || '');
        kn.o.textContent = ex[e][3] || '';
        kn.el.hidden = false;
      } else kn.el.hidden = true;
    }

    cEn.textContent = w.en || ''; cEn.hidden = !(S.showEn && w.en);
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    fit();
    paintChrome();
  }

  /* ---------------- かな 타자 연습 ----------------
     읽기를 확인하는 유일한 방법이 '쓰게 하는 것'이라 이 카드만 입력칸을 품는다.
     맞으면 바로 다음 글자로 넘어가고, S.kanaTries 번 틀리면 정답을 보여준 뒤 그걸 그대로 치게 한다. */
  var roundN = 0, cleared = {}, roundOk = 0, roundNg = 0;
  // roundMiss: 이번 바퀴에 틀린 글자 -> 틀린 횟수. retryList 가 있으면 다음 덱은 그 글자들만으로 만든다.
  var roundMiss = {}, retryList = null, retryRound = false;
  var drillWrong = 0, drillShown = false, drillDone = false, fbT = 0;

  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '-'; }
  function clearedN() { var n = 0; for (var k in cleared) n++; return n; }

  function resetDrill() {
    clearTimeout(fbT);
    drillWrong = 0; drillShown = false; drillDone = false;
    kanaIn.value = '';
    kanaAns.classList.remove('on');
    kanaAnsR.textContent = ''; kanaAnsH.textContent = ''; kanaAnsA.textContent = '';
    card.classList.remove('ok'); card.classList.remove('ng');
    kanaTip.textContent = '로마자로 입력하면 바로 넘어갑니다';
  }
  // 입력칸에 포커스가 없으면 타자 연습이 성립하지 않는다. 다른 패널이 열려 있을 때는 빼앗지 않는다.
  function focusDrill() {
    if (screen !== 'study' || S.set !== 'kana') return;
    if (panel.dataset.open === '1' || help.dataset.open === '1' || kanaPick.dataset.open === '1') return;
    try { kanaIn.focus({ preventScroll: true }); } catch (e) { try { kanaIn.focus(); } catch (e2) {} }
  }

  function paintKana(w) {
    cLv.textContent = w.g.charAt(0) === 'h' ? 'ひらがな' : 'カタカナ';
    cPos.textContent = w.gn.replace(/^(히라가나|가타카나)\s*/, '');
    var ks = KSTAT[w.c] || [0, 0];
    cSeen.textContent = (ks[0] + ks[1]) ? '정답 ' + ks[0] + ' · 오답 ' + ks[1] : '';

    cKana.textContent = '';
    cWord.textContent = w.c;
    cWord.classList.add('is-kana');
    card.classList.add('is-drill');
    card.style.setProperty('--f-kana', kanaFontStack());

    cRead.hidden = true; cHjp.hidden = true; cAlt.hidden = true;
    meanWrap.hidden = true; cEx.hidden = true; cKex.hidden = true; cEn.hidden = true;
    ruleEx.hidden = true; rule1.hidden = false;
    cDrill.hidden = false;

    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    fit();
    paintChrome();
  }

  function drawAnswerLine(withAlt) {
    var w = current();
    if (!w || w.kind !== 'n') return;
    kanaAnsR.textContent = w.r;
    kanaAnsH.textContent = S.kanaShowH ? w.h : '';
    kanaAnsA.textContent = (withAlt && w.ans.length > 1) ? w.ans.slice(1).join(' · ') : '';
    kanaAns.classList.add('on');
    // 자리는 min-height 로 잡아 뒀지만, 그래도 안 맞는 화면이 있으면 정답이 안 보이는 것보다
    // 카드가 한 번 줄어드는 편이 낫다. 자리가 맞으면 fit() 은 아무것도 안 한다.
    fit();
  }

  /* ---------------- 읽기 ----------------
     문장 하나가 [루비 원문][눈 버튼][번역] 한 묶음이다. 문장을 누르면 かな 읽기를 TTS 로 읽는다 —
     한자 표기를 그대로 넘기면 음성이 읽기를 틀린다(단어 카드와 같은 이유). */
  var artNodes = [];
  var koOpen = {};        // 이 기사에서 열어 둔 문장 번호
  var sentIdx = 0;        // 한 문장씩 모드에서 지금 보는 줄 (0 = 제목)

  function makeRuby(parts, host) {
    host.textContent = '';
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i][0], r = parts[i][1];
      if (r == null) { host.appendChild(document.createTextNode(t)); continue; }
      var ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(t));
      var rt = document.createElement('rt');
      rt.textContent = r;
      ruby.appendChild(rt);
      host.appendChild(ruby);
    }
  }

  function artNode(i) {
    if (artNodes[i]) return artNodes[i];
    var row = document.createElement('div'); row.className = 'art-row';
    var jp = document.createElement('p'); jp.className = 'art-jp';
    jp.title = '클릭하면 이 문장 발음';
    var eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'eye';
    eye.setAttribute('aria-label', '이 문장 뜻 보기');
    eye.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9 4.5-9 7s4 7 9 7 9-4.5 9-7-4-7-9-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z"/></svg>';
    var ko = document.createElement('p'); ko.className = 'art-ko';
    var head = document.createElement('div'); head.className = 'art-head';
    head.appendChild(jp); head.appendChild(eye);
    row.appendChild(head); row.appendChild(ko);
    artBody.appendChild(row);
    var n = { el: row, jp: jp, eye: eye, ko: ko, i: i };
    jp.onclick = function () {
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;
      var w = current(); if (!w || w.kind !== 'r') return;
      if (S.readOne && i !== sentIdx) { sentIdx = i; paint(); return; }   // 미리보기 줄을 누르면 그리로
      var s = i === 0 ? { k: w.tk } : w.s[i - 1];
      if (!s || !s.k) return;
      var rc = readClip(w, i);
      if (rc) { stopSpeak(); playClip(rc, s.k); return; }
      speakOne(s.k);
    };
    eye.onclick = function (e) {
      e.stopPropagation();
      if (koOpen[i]) delete koOpen[i]; else koOpen[i] = 1;
      drawKo(n);
    };
    artNodes[i] = n;
    return n;
  }

  // 번역 전체 열기는 '이 기사의 모든 문장 번호'를 다시 세우는 일이다 (제목이 0번이라 <= 로 돈다)
  function syncKoAll(w) {
    koOpen = {};
    if (S.koAll && w) for (var i = 0; i <= w.s.length; i++) koOpen[i] = 1;
  }
  function applyKoAll() {
    var w = current();
    if (w && w.kind === 'r') {
      syncKoAll(w);
      each(artNodes, function (n) { if (!n.el.hidden) drawKo(n); });
    }
    paintChrome();
  }

  function drawKo(n) {
    var on = !!koOpen[n.i];
    n.ko.hidden = !on;
    n.eye.classList.toggle('on', on);
    n.eye.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function artRows(w) { return [{ r: w.t, o: w.to }].concat(w.s); }

  /* 읽기 이동: 한 문장씩 모드에서는 문장 단위로 움직이고, 끝에 닿으면 기사를 넘긴다.
     전체 보기 모드에서는 기사 단위로만 움직인다. */
  function readMove(delta) {
    var w = current();
    if (!w || w.kind !== 'r') return;
    if (!S.readOne) { readArticle(delta); return; }
    var n = artRows(w).length;
    var next = sentIdx + delta;
    if (next >= 0 && next < n) { sentIdx = next; paint(); return; }
    readArticle(delta, delta > 0 ? 'first' : 'last');
  }
  function readArticle(delta, at) {
    if (!deck.length) return;
    idx += delta;
    if (idx >= deck.length) idx = 0;
    if (idx < 0) idx = deck.length - 1;
    var w = current();
    sentIdx = (at === 'last' && w) ? artRows(w).length - 1 : 0;
    elapsed = 0;
    markSeen();
    paint();
    syncHash();
  }

  function paintArticle(w) {
    cLv.textContent = READ && READ.src ? READ.src.name : '뉴스';
    cPos.textContent = w.n + '문장';
    var seen = VIEWS[uid(w)] || 0;
    cSeen.textContent = seen ? '본 횟수 ' + seen : '';

    cKana.textContent = '';
    cWord.textContent = '';
    cWord.classList.remove('is-kana');
    card.classList.remove('is-drill');
    cWord.hidden = true;
    cRead.hidden = true; cHjp.hidden = true; cAlt.hidden = true;
    meanWrap.hidden = true; cEx.hidden = true; cKex.hidden = true; cEn.hidden = true;
    cDrill.hidden = true; ruleEx.hidden = true; rule1.hidden = false;
    cArt.hidden = false;
    card.classList.add('is-read');

    syncKoAll(w);

    var rows = artRows(w);
    if (sentIdx >= rows.length) sentIdx = rows.length - 1;
    if (sentIdx < 0) sentIdx = 0;

    /* 한 문장씩: 지금 줄만 크게, 뒤따르는 두 줄은 작게 미리 보여 준다.
       기사를 통째로 한 화면에 넣으면 문장이 작아지고 루비는 그보다 더 작아진다 — 濁点이 안 보인다. */
    artBody.classList.toggle('one', S.readOne);
    for (var i = 0; i < rows.length; i++) {
      var n = artNode(i);
      var rel = i - sentIdx;
      var show = S.readOne ? (rel >= 0 && rel <= 2) : true;
      n.el.hidden = !show;
      n.el.classList.toggle('is-title', i === 0);
      n.el.classList.toggle('is-now', S.readOne && rel === 0);
      n.el.classList.toggle('is-next', S.readOne && rel > 0);
      if (!show) continue;
      makeRuby(rows[i].r, n.jp);
      n.ko.textContent = rows[i].o || '';
      n.eye.hidden = !rows[i].o || (S.readOne && rel !== 0);
      drawKo(n);
    }
    for (var j = rows.length; j < artNodes.length; j++) artNodes[j].el.hidden = true;

    // 제목에서 벗어나면 어느 기사를 읽는 중인지 위에 작게 남겨 둔다
    cKana.textContent = (S.readOne && sentIdx > 0) ? w.t.map(function (p) { return p[0]; }).join('') : '';
    cKana.hidden = !cKana.textContent;

    artSrc.textContent = '';
    var a = document.createElement('a');
    a.href = w.u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'ウィキニュース 원문';
    artSrc.appendChild(a);
    var lic = document.createElement('span');
    lic.textContent = (w.d ? w.d + ' · ' : '') + (READ.src.license || '');
    artSrc.appendChild(lic);

    document.documentElement.dataset.furi = S.furi ? '1' : '0';
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    fit();
    paintChrome();
  }

  function drillInput() {
    var w = current();
    if (!w || w.kind !== 'n' || drillDone) return;
    var v = kanaIn.value.toLowerCase().replace(/[^a-z]/g, '');
    if (kanaIn.value !== v) kanaIn.value = v;
    if (!v) return;
    if (w.ans.indexOf(v) >= 0) { drillHit(); return; }
    // 아직 정답의 앞부분이면 기다린다 (k -> ki). 어느 정답의 앞부분도 아니면 그 순간 틀린 것이다.
    for (var i = 0; i < w.ans.length; i++) if (w.ans[i].indexOf(v) === 0) return;
    drillMiss();
  }

  function drillHit() {
    var w = current();
    drillDone = true;
    var st = KSTAT[w.c] || [0, 0];
    // 한 번에 맞힌 글자만 '뗐다'고 센다. 틀린 글자는 덱 뒤로 다시 들어가 있으므로
    // 바퀴가 끝날 때는 반드시 전부 떼어진 상태가 된다.
    if (!drillWrong) { st[0]++; roundOk++; cleared[w.c] = 1; }
    KSTAT[w.c] = st; lsSet(K_KSTAT, KSTAT);
    card.classList.remove('ng'); void card.offsetWidth; card.classList.add('ok');
    drawAnswerLine(false);
    kanaTip.textContent = '';
    speakOne(w.c);
    paintChrome();
    // 발음이 끝날 때까지 기다리지 않는다. 다음 글자가 떠도 방금 글자의 소리는 계속 들린다.
    fbT = setTimeout(drillNext, 230);
  }

  function drillMiss() {
    var w = current();
    if (!drillWrong) {
      var st = KSTAT[w.c] || [0, 0];
      st[1]++; KSTAT[w.c] = st; lsSet(K_KSTAT, KSTAT); roundNg++;
      deck.push(w);   // 틀린 글자는 이번 바퀴가 끝나기 전에 다시 나온다
    }
    roundMiss[w.c] = (roundMiss[w.c] || 0) + 1;
    drillWrong++;
    kanaIn.value = '';
    card.classList.remove('ok'); void card.offsetWidth; card.classList.add('ng');
    clearTimeout(fbT);
    fbT = setTimeout(function () { card.classList.remove('ng'); }, 420);
    if (!drillShown && drillWrong >= Math.max(1, S.kanaTries)) showAnswer();
    else if (!drillShown) {
      var left = Math.max(1, S.kanaTries) - drillWrong;
      kanaTip.textContent = left <= 1 ? '한 번 더 틀리면 정답을 보여줍니다' : '다시 (' + left + '번 남음)';
    }
    paintChrome();
  }

  function showAnswer() {
    var w = current();
    if (!w || w.kind !== 'n' || drillDone) return;
    if (!drillShown && !drillWrong) {   // 스스로 정답을 열었으면 오답으로 센다
      var st = KSTAT[w.c] || [0, 0];
      st[1]++; KSTAT[w.c] = st; lsSet(K_KSTAT, KSTAT); roundNg++;
      drillWrong = 1; deck.push(w);
      roundMiss[w.c] = (roundMiss[w.c] || 0) + 1;
    }
    drillShown = true;
    drawAnswerLine(true);
    // 건너뛰는 게 아니라는 걸 말해 줘야 한다 — 틀린 글자는 deck 뒤에 다시 꽂혀 있다
    kanaTip.textContent = '정답을 그대로 입력하면 넘어갑니다 · 이 글자는 이번 바퀴에 다시 나옵니다';
    speakOne(w.c);
    paintChrome();
  }

  function drillNext() {
    clearTimeout(fbT);
    if (!deck.length) { paint(); return; }
    idx++;
    if (idx >= deck.length) {           // 한 바퀴 끝
      recordRound();
      if (missList().length) { screen = 'done'; stopSpeak(); kanaIn.blur(); paint(); return; }
      // 다 맞혔으면 보여줄 게 없다. 멈추지 않고 다음 바퀴로 — 지금까지의 동작 그대로.
      toast('한 바퀴 완료 · 정답률 ' + pct(roundOk, roundOk + roundNg)
        + (KREC.streak > 1 ? ' · 만점 ' + KREC.streak + '연속' : ''));
      nextRound();
      return;
    }
    markSeen(); resetDrill(); paint(); focusDrill();
  }

  /* 한 바퀴가 끝날 때 기록을 남긴다. '틀린 글자만 다시' 바퀴는 세지 않는다 —
     5자짜리 바퀴가 정답률과 최고 기록을 흐려 놓는다. */
  function recordRound() {
    if (retryRound) return;
    var tot = roundOk + roundNg;
    if (!tot) return;
    var acc = Math.round((roundOk / tot) * 100);
    KREC.n++; KREC.ok += roundOk; KREC.ng += roundNg;
    if (!roundNg) { KREC.perfect++; KREC.streak++; if (KREC.streak > KREC.bestStreak) KREC.bestStreak = KREC.streak; }
    else KREC.streak = 0;
    // 같은 정답률이면 글자 수가 많은 바퀴가 더 어려운 바퀴다
    if (acc > KREC.best || (acc === KREC.best && roundN > KREC.bestN)) { KREC.best = acc; KREC.bestN = roundN; }
    lsSet(K_KREC, KREC);
  }
  // 기록 한 줄. 아직 한 바퀴도 안 끝냈으면 빈 문자열.
  function recLine() {
    if (!KREC.n) return '';
    var out = '최고 ' + (KREC.best < 0 ? '-' : KREC.best + '%');
    if (KREC.bestN) out += '(' + KREC.bestN + '자)';
    out += ' · 누적 정답률 ' + pct(KREC.ok, KREC.ok + KREC.ng) + ' · ' + KREC.n + '바퀴';
    if (KREC.perfect) out += ' · 만점 ' + KREC.perfect + '번';
    if (KREC.bestStreak > 1) out += ' · 최고 연속 ' + KREC.bestStreak;
    return out;
  }

  // 많이 틀린 순서. 같은 횟수면 표에 나온 순서를 지켜 히라가나가 먼저 오게 한다.
  function missList() {
    var out = [];
    for (var c in roundMiss) out.push(c);
    return out.sort(function (a, b) { return roundMiss[b] - roundMiss[a] || KANA_ORDER[a] - KANA_ORDER[b]; });
  }
  // かな 전용이다. 예전엔 여기서 S.seed 를 굴렸는데, 그러면 かな 한 바퀴를 끝낼 때마다
  // 단어 덱 순서까지 바뀐다. かな 는 이제 자기 씨앗을 쓰므로 건드릴 이유가 없다.
  function nextRound() {
    screen = 'study';
    buildDeck();
  }
  function paintSummary() {
    var miss = missList(), box = $('sumGrid');
    var total = roundN || 1;
    // clearedN() 은 '떼어낸 글자'라 틀린 뒤 다시 맞힌 것도 들어간다. 여기서는 틀린 글자 수를 쓴다.
    $('sumLine').textContent = total + '자 중 ' + miss.length + '자를 틀렸습니다 · 정답률 '
      + pct(roundOk, roundOk + roundNg);
    $('sumRec').textContent = recLine();
    box.textContent = '';
    for (var i = 0; i < miss.length; i++) {
      var c = miss[i], meta = KANA.i[c];
      var el = document.createElement('div'); el.className = 'miss';
      var b = document.createElement('b'); b.textContent = c;
      var r = document.createElement('i'); r.textContent = meta.r + ' · ' + meta.h;
      var n = document.createElement('em'); n.textContent = roundMiss[c] + '번';
      el.appendChild(b); el.appendChild(r); el.appendChild(n);
      box.appendChild(el);
    }
    $('btnRetryMiss').textContent = '틀린 ' + miss.length + '자만 다시';
    var kb = document.createElement('kbd'); kb.textContent = '↵';
    $('btnRetryMiss').appendChild(document.createTextNode(' '));
    $('btnRetryMiss').appendChild(kb);
  }
  $('btnRetryMiss').onclick = function () { retryList = missList(); nextRound(); };
  $('btnNextRound').onclick = function () { nextRound(); };

  function drillSkip() {
    var w = current();
    if (w && w.kind === 'n' && !drillDone && !drillWrong) deck.push(w);
    drillNext();
  }

  function paint() {
    if (screen === 'home') {
      home.hidden = false; card.hidden = true; empty.hidden = true; summary.hidden = true;
      paintHome(); paintChrome(); return;
    }
    if (screen === 'done') {
      summary.hidden = false; home.hidden = true; card.hidden = true; empty.hidden = true;
      paintSummary(); paintChrome(); return;
    }
    home.hidden = true; summary.hidden = true;
    var w = current();
    var has = !!w;
    card.hidden = !has;
    empty.hidden = has;
    if (!has) { paintEmpty(); paintChrome(); return; }
    if (w.kind !== 'n') {
      cDrill.hidden = true;
      cWord.classList.remove('is-kana');
      card.classList.remove('is-drill');
      card.style.removeProperty('--f-kana');
      cRead.hidden = false; meanWrap.hidden = false;
    }
    if (w.kind !== 'r') { cArt.hidden = true; cWord.hidden = false; card.classList.remove('is-read'); }
    if (w.kind === 'r') { paintArticle(w); return; }
    if (w.kind === 'n') { paintKana(w); return; }
    if (w.kind === 'k') { paintKanji(w); return; }
    cKex.hidden = true;

    cLv.textContent = LV_LABEL[w.lv] || ('N' + w.lv);
    cPos.textContent = w.p || '';
    var seen = VIEWS[uid(w)] || 0;
    cSeen.textContent = seen ? '본 횟수 ' + seen : '';

    cKana.textContent = w.k || '';
    cWord.textContent = w.w || '';
    cHangul.textContent = pron((S.longVowel && w.hL ? w.hL : w.h) || '');

    if (w.hj) { cHanjaV.textContent = w.hj; cHanja.hidden = false; }
    else { cHanja.hidden = true; }
    // 한자음이 한국어 뜻과 같은 단어 = 사실상 이미 아는 단어
    cHanja.classList.toggle('is-same', !!w.same);

    // 복수 읽기·복수 표기 (九 きゅう/く, いい/よい)
    var alt = [];
    if (w.kAlt && w.kAlt.length) alt.push('다른 읽기 ' + w.kAlt.join(' · '));
    if (w.wAlt && w.wAlt.length) alt.push('다른 표기 ' + w.wAlt.join(' · '));
    cAlt.textContent = alt.join('   ');
    cAlt.hidden = !alt.length;

    // 한자별 한자음
    cHjp.classList.remove('k-read');
    var parts = w.hjp ? String(w.hjp).split(/\s+/).filter(Boolean) : [];
    for (var i = 0; i < hjpNodes.length; i++) {
      var n = hjpNodes[i];
      if (i < parts.length) {
        var mm = HANGUL.exec(parts[i]);
        n.k.textContent = mm ? mm[1] : parts[i];
        n.h.textContent = mm ? mm[2] : '';
        n.el.hidden = false;
      } else n.el.hidden = true;
    }
    cHjp.hidden = !parts.length;

    // 뜻
    var ko = Array.isArray(w.ko) ? w.ko.slice(0, 3) : (w.ko ? [w.ko] : []);
    for (var j = 0; j < meanNodes.length; j++) {
      var mn = meanNodes[j];
      if (j < ko.length) {
        mn.num.textContent = ko.length > 1 ? String(j + 1) : '';
        mn.num.hidden = ko.length <= 1;
        mn.txt.textContent = ko[j];
        mn.li.hidden = false;
      } else mn.li.hidden = true;
    }
    revealed = !S.hide;
    meanWrap.classList.toggle('masked', !revealed);

    // 예문
    var showEx = S.showEx && !!(w.e || w.ek || w.eo);
    cEx.hidden = !showEx; ruleEx.hidden = !showEx;
    if (showEx) {
      cExJ.textContent = w.e || ''; cExJ.hidden = !w.e;
      cExK.textContent = w.ek || ''; cExK.hidden = !w.ek;
      var ehTxt = (S.longVowel && w.ehL ? w.ehL : w.eh) || '';
      cExH.textContent = pron(ehTxt); cExH.hidden = !(S.showExH && ehTxt);
      cPron.hidden = cExK.hidden && cExH.hidden;
      cExO.textContent = w.eo || ''; cExO.hidden = !w.eo;
    }

    cEn.textContent = w.en || ''; cEn.hidden = !(S.showEn && w.en);

    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    fit();
    paintChrome();
  }

  function paintEmpty() {
    var t = $('emptyTitle'), b = $('emptyBody'), fix = $('btnEmptyFix');
    fix.textContent = '설정 열기';
    if (S.set === 'kana' && ALL_N.length) {
      t.textContent = '연습할 글자가 없습니다';
      b.textContent = '오십음도에서 연습할 열을 하나 이상 고르세요.';
      fix.textContent = '글자 고르기';
      fix.hidden = false;
      return;
    }
    if (!ALL.length) {
      t.textContent = '단어 데이터가 없습니다';
      b.innerHTML = '<code>data/words-n5.js</code> 같은 데이터 파일을 넣고 새로고침하세요. 파일이 하나만 있어도 동작합니다.';
      fix.hidden = true;
    } else if (S.study === 'srs') {
      t.textContent = '지금 복습할 카드가 없습니다';
      b.textContent = Object.keys(SRS).length
        ? '채점한 카드가 아직 복습 시점이 안 됐습니다. 전체 재생이나 배치 루프로 돌려두세요.'
        : '아직 채점한 카드가 없습니다. 다른 모드에서 1·2·3 으로 채점하면 여기 모입니다.';
      fix.hidden = false;
    } else if (S.deck === 'fav') {
      t.textContent = '즐겨찾기한 단어가 없습니다';
      b.textContent = '카드를 보다가 즐겨찾기 버튼이나 S 키를 누르면 여기에 모입니다.';
      fix.hidden = false;
    } else if (S.tier !== 'all') {
      t.textContent = TIER_LABEL[S.tier] + ' 조건에 맞는 단어가 없습니다';
      b.textContent = '설정에서 한자음 필터를 전체로 되돌리거나 다른 급수를 선택하세요.';
      fix.hidden = false;
    } else {
      t.textContent = '선택한 급수에 단어가 없습니다';
      b.textContent = '설정에서 다른 급수를 선택하세요.';
      fix.hidden = false;
    }
  }

  var deckinfoKey = null;
  function setDeckinfo(parts) {
    var key = parts.join('\n');
    if (key === deckinfoKey) return;
    deckinfoKey = key;
    deckinfo.textContent = '';
    parts.forEach(function (s) {
      var el = document.createElement('span'); el.textContent = s; deckinfo.appendChild(el);
    });
  }

  function paintChrome() {
    var w = current(), kana = S.set === 'kana', reading = S.set === 'reading';
    var atHome = screen === 'home', atDone = screen === 'done';
    dock.hidden = atHome || atDone;       // 정리 화면에는 조작할 카드가 없다
    $('btnHome').hidden = atHome;
    $('btnMark').disabled = atHome;       // 제목 줄도 학습 선택으로 가는 문이다
    $('btnKanaPick').hidden = atHome || !kana;
    // 세로가 짧을 때(=키보드가 올라왔을 때) 크롬을 접는 CSS 가 이 값을 본다
    document.documentElement.dataset.drill = (kana && !atHome && !atDone) ? '1' : '0';
    if (atHome || atDone) { setDeckinfo([]); return; }

    // かな 는 카드 위치가 아니라 '이번 바퀴에 뗀 글자 수'가 진척이다 — 틀린 글자가 덱에 다시 들어오므로.
    counter.textContent = kana
      ? clearedN() + ' / ' + (roundN || deck.length)
      : (deck.length ? (idx + 1) + ' / ' + deck.length : '0 / 0');
    // 분수가 둘 붙으면 어느 쪽이 기사인지 알 수 없다 — 이름표를 붙여 둔다
    if (reading && w) {
      counter.textContent = '기사 ' + (idx + 1) + '/' + deck.length
        + (S.readOne ? '  ·  ' + (sentIdx === 0 ? '제목' : '문장 ' + sentIdx + '/' + w.s.length) : '');
    }

    $('grades').hidden = kana || reading || S.study === 'all';
    drillActs.hidden = !kana;
    readActs.hidden = !reading;
    $('btnAllKo').classList.toggle('on', S.koAll);
    $('btnFuri').classList.toggle('on', S.furi);
    $('btnOne').classList.toggle('on', S.readOne);
    dockrow.classList.toggle('is-drill', kana);
    dockrow.classList.toggle('is-read', reading);
    transport.hidden = kana;
    // 읽기는 스스로 넘긴다 — 남은 시간 바나 재생 버튼이 있으면 쫓기게 된다. 기사 이동만 남긴다.
    $('btnPlay').hidden = reading;
    $('btnFirst').hidden = reading;
    progress.hidden = kana || reading;
    if (kana) {
      $('btnKanaShow').disabled = !w || drillShown || drillDone;
      $('btnKanaSkip').disabled = !w;
    }

    var parts = [];
    if (kana) {
      parts = ['かな 타자', retryRound ? '틀린 글자 ' + (roundN || deck.length) + '자 다시'
                                        : KCOLS.length + '열 · ' + (roundN || deck.length) + '자'];
      if (roundOk + roundNg) parts.push('정답률 ' + pct(roundOk, roundOk + roundNg));
    } else if (reading) {
      parts = ['읽기', (READ && READ.src ? READ.src.name : '뉴스') + ' ' + deck.length + '편'];
    } else if (ALL.length) {
      var lvTxt = activeLevels().map(function (n) { return LV_LABEL[n]; }).join(' ');
      var modeTxt = S.study === 'batch' ? '배치 루프' : S.study === 'srs' ? '복습' : (S.deck === 'fav' ? '즐겨찾기' : '전체');
      if (S.set === 'kanji') modeTxt = '한자 · ' + modeTxt;
      else if (S.tier !== 'all') modeTxt += ' · ' + TIER_LABEL[S.tier];
      parts = [lvTxt || '급수 없음',
               modeTxt + ' ' + deck.length + (S.set === 'kanji' ? '자' : '단어'),
               S.study === 'srs' ? '복습 대상 ' + dueCount() + '개' : (S.shuffle ? '셔플' : '순서대로')];
    }
    // paintChrome 은 かな 타자 한 글자마다 돈다. 같은 문구면 span 을 새로 만들지 않는다.
    setDeckinfo(parts);

    var fav = w ? !!FAV[uid(w)] : false;
    btnFav.setAttribute('aria-pressed', fav ? 'true' : 'false');
    starGlyph.textContent = fav ? '★' : '☆';
    btnFav.disabled = !w;
    // かな 카드에서 답하기 전에 발음을 들려주면 정답을 알려주는 셈이다
    var canSay = voices.length || (w && w.kind === 'n' && kanaClip(w.c));
    $('btnSpeak').disabled = !w || !S.tts || !canSay || (kana && !drillShown && !drillDone);
  }

  /* ---------------- 화면 전환 ---------------- */
  function goHome() {
    screen = 'home';
    stopSpeak(); setPlaying(false);
    kanaIn.blur();
    document.body.classList.remove('idle');
    paint();
    writeHash(null);
  }
  function enterMode(name, atUid) {
    need(name, function () {
      useSet(name);
      screen = 'study';
      drawSet(); drawStudy(); drawLevels(); drawTier();
      buildDeck(atUid || lsGet(K_POS, null));
      setPlaying(S.set !== 'kana' && S.set !== 'reading' && deck.length > 0);
      markSeen();
      paint();
      syncHash();
      focusDrill();
      wake();
    });
  }

  /* ---------------- 기사 직접 링크 ----------------
     #read=r44444 로 기사 하나를 바로 연다. 공유용이다.
     history.pushState 는 file:// 에서 origin 이 null 이라 던진다 — 그래서 location.hash 만 쓴다 (절대 규칙 1).
     슬러그는 data/reading.js 의 기사 id 다. wikinews 문서 번호라 덱을 다시 만들어도 안 바뀐다 —
     난이도순 정렬이 바뀌는 순번을 쓰면 공유한 링크가 딴 기사를 가리킨다. */
  var hashLock = false;
  function hashArticle() {
    var m = /(?:^|[#&])read=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    return m ? m[1] : null;
  }
  function writeHash(id) {
    if ((hashArticle() || '') === (id || '')) return;
    hashLock = true;
    location.hash = id ? 'read=' + id : '';
    setTimeout(function () { hashLock = false; }, 0);
  }
  // 주소창이 지금 보고 있는 기사를 가리키게 한다. 읽기 모드가 아니면 비운다.
  function syncHash() {
    var w = current();
    writeHash(screen === 'study' && S.set === 'reading' && w && w.kind === 'r' ? w.i : null);
  }
  window.addEventListener('hashchange', function () {
    if (hashLock) return;                       // 우리가 쓴 해시다
    var id = hashArticle();
    if (!id) { if (screen === 'study' && S.set === 'reading') goHome(); return; }
    var w = current();
    if (screen === 'study' && S.set === 'reading' && w && w.i === id) return;
    enterMode('reading', 'r-' + id);
  });

  // 카드가 화면을 넘지 않게 맞춘다. 세로(전체 스케일) 먼저, 그다음 표기 가로 폭.
  var fitT = 0;
  function fit() {
    card.style.removeProperty('--scale');
    cWord.style.fontSize = '';
    if (card.hidden) return;
    // 한 문장씩 읽기는 글자를 키우려고 만든 모드다. 넘치면 줄이지 말고 스테이지를 스크롤한다.
    var one = S.set === 'reading' && S.readOne;
    document.documentElement.dataset.readone = one ? '1' : '0';
    if (one) return;

    /* 카드 높이 = 안 줄어드는 부분(여백·간격·테두리) + 줄어드는 부분 × --scale 이다.
       두 배율에서 한 번씩 재면 둘 다 풀리므로 필요한 배율을 바로 구한다.
       넘치는 비율만큼 곱해서 줄이면 안 줄어드는 부분까지 같이 줄이는 셈이라 지나치게 작아진다 —
       키보드가 올라온 화면에서 0.85면 될 것이 0.64까지 내려갔다. */
    var base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    var sp = getComputedStyle(stage);
    var avail = stage.clientHeight - parseFloat(sp.paddingTop) - parseFloat(sp.paddingBottom);
    var lo = base * 0.5;
    if (avail > 40 && card.getBoundingClientRect().height > avail) {
      var h1 = card.getBoundingClientRect().height;
      card.style.setProperty('--scale', lo);
      var h2 = card.getBoundingClientRect().height;
      var slope = (h1 - h2) / (base - lo);           // --scale 1 당 높이
      var s = slope > 0 ? (avail - (h1 - slope * base)) / slope : lo;
      card.style.setProperty('--scale', Math.min(base, Math.max(lo, s)));
    }

    var box = card.clientWidth;
    var size = parseFloat(getComputedStyle(cWord).fontSize) || 48;
    for (var p2 = 0; p2 < 2 && box; p2++) {
      var sw = cWord.scrollWidth;
      if (sw <= box || size <= 14) break;
      size = Math.max(14, size * (box / sw));
      cWord.style.fontSize = size + 'px';
    }
  }
  window.addEventListener('resize', function () { clearTimeout(fitT); fitT = setTimeout(fit, 120); });

  /* ---------------- 이동 ---------------- */
  var playing = true, elapsed = 0;

  function markSeen() {
    var w = current(); if (!w) return;
    var k = uid(w); VIEWS[k] = (VIEWS[k] || 0) + 1; dirty = true;
    lsSet(K_POS, k);
  }
  function go(delta, manual) {
    if (!deck.length) return;
    if (S.set === 'kana') { if (delta > 0) drillSkip(); return; }   // かな 는 답을 쳐서 넘긴다
    if (S.set === 'reading') { readMove(delta); return; }
    idx += delta;
    if (idx >= deck.length) {
      idx = 0;
      if (S.shuffle) { S.seed = (S.seed * 1103515245 + 12345) >>> 0 || 1; save(); deck = shuffled(deck, S.seed); }
    }
    if (idx < 0) idx = deck.length - 1;
    elapsed = 0;
    markSeen(); paint();
    if (S.ttsAuto || manual === 'speak') speak(); else dropPending();
  }
  /* 채점: 0 몰라요 / 1 애매 / 2 알아요.
     모드와 무관하게 기록한다 — 나중에 복습 모드로 바꾸면 바로 쓰인다. */
  function grade(q) {
    var w = current(); if (!w) return;
    var k = uid(w), r = SRS[k] || { b: 0, n: 0 };
    r.b = q === 2 ? Math.min(r.b + 1, BOX_MS.length - 1) : q === 1 ? Math.max(0, r.b - 1) : 0;
    r.n = (r.n || 0) + 1;
    r.d = Date.now() + BOX_MS[r.b];
    SRS[k] = r; saveSrs();
    toast(['몰라요', '애매', '알아요'][q] + ' · 다음 복습 ' + humanGap(BOX_MS[r.b]));
    if (S.study === 'srs') {           // 복습 모드에서는 채점한 카드를 덱에서 빼고 진행
      deck.splice(idx, 1);
      if (idx >= deck.length) idx = 0;
      elapsed = 0;
      if (!deck.length) { paint(); return; }
      markSeen(); paint(); if (S.ttsAuto) speak(); else dropPending();
    } else go(1);
    paintChrome();
  }
  function humanGap(ms) {
    var d = ms / 864e5;
    return d < 1 ? Math.round(ms / 6e4) + '분 후' : Math.round(d) + '일 후';
  }
  var toastT = 0;
  function toast(msg) {
    var el = $('toast'); if (!el) return;
    el.textContent = msg; el.dataset.on = '1';
    clearTimeout(toastT); toastT = setTimeout(function () { el.dataset.on = '0'; }, 1400);
  }

  function setPlaying(v) {
    playing = v;
    icPlay.firstElementChild.setAttribute('d', v ? ICON_PAUSE : ICON_PLAY);
    $('btnPlay').setAttribute('aria-label', v ? '일시정지' : '재생');
    if (v) { startTick(); wake(); lockScreen(); }
    else { stopTick(); document.body.classList.remove('idle'); releaseScreen(); }
  }

  /* ---------------- 타이머 (rAF 단일 루프) ----------------
     재생 중일 때만 돈다. 시작 화면·かな·읽기·일시정지에서도 계속 깨우면
     하는 일 없이 1초에 60번 메인 스레드를 건드린다 (휴대폰 배터리). */
  var last = 0, raf = 0;
  function startTick() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
  function stopTick() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function tick(t) {
    raf = requestAnimationFrame(tick);
    var dt = last ? Math.min(t - last, 250) : 0;
    last = t;
    // かな·읽기는 시간이 아니라 사용자가 넘긴다
    if (!playing || !deck.length || S.set === 'kana' || S.set === 'reading') return;
    elapsed += dt;
    // 배지 단어는 이미 아는 단어라 빨리 넘겨도 된다 (옵션)
    var cw = current();
    var dur = S.sec * 1000 * (S.fastSame && cw && cw.same ? 0.5 : 1);
    bar.style.transform = 'scaleX(' + Math.min(elapsed / dur, 1) + ')';
    if (!revealed && elapsed >= S.hideDelay * 1000) reveal();
    if (elapsed >= dur) go(1);
  }

  function reveal() { revealed = true; meanWrap.classList.remove('masked'); }

  /* ---------------- 발음 ---------------- */
  var SS = window.speechSynthesis || null, voices = [], voiceTries = 0;
  function loadVoices() {
    if (!SS) return;
    var all = [];
    try { all = SS.getVoices() || []; } catch (e) { all = []; }
    voices = all.filter(function (v) { return /^ja/i.test(v.lang || ''); });
    var sel = $('selVoice');
    sel.textContent = '';
    if (!voices.length) {
      var o = document.createElement('option'); o.textContent = '일본어 음성 없음'; sel.appendChild(o);
      sel.disabled = true; $('swTts').disabled = true;
      $('ttsHint').textContent = '이 브라우저에 일본어(ja) 음성이 없어 발음 기능을 사용할 수 없습니다.';
      if (voiceTries++ < 6) setTimeout(loadVoices, 400);
    } else {
      voices.sort(function (a, b) { return voiceScore(b) - voiceScore(a); });
      voices.forEach(function (v) {
        var o = document.createElement('option'); o.value = v.name;
        o.textContent = v.name + ' (' + v.lang + ')' + voiceTag(v); sel.appendChild(o);
      });
      if (S.voice && voices.some(function (v) { return v.name === S.voice; })) sel.value = S.voice;
      else { S.voice = pickVoice(); sel.value = S.voice; save(); }
      sel.disabled = false; $('swTts').disabled = false;
      $('ttsHint').textContent = HAS_GOOD.test(S.voice)
        ? '카드가 바뀌면 이전 발화를 멈추고 새로 읽습니다.'
        : '지금 음성은 macOS 기본 압축판이라 음질이 나쁩니다. 시스템 설정 → 손쉬운 사용 → 음성 콘텐츠 → 시스템 음성 → 음성 관리에서 일본어 고급/프리미엄 음성을 받으면 훨씬 나아집니다.';
    }
    syncMute(); // 음성 목록은 비동기로 도착하므로 음소거 버튼 상태를 다시 맞춘다
    paintChrome();
  }
  // Apple 노벨티 음성. 일본어 목록에도 끼어 있고 알아듣기 어렵다 — 자동 선택에서 뒤로 뺀다.
  var NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Bells|Boing|Bubbles|Jester|Junior|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Albert|Bahh|Bad News|Good News)\b/i;
  var HAS_GOOD = /premium|enhanced|natural|프리미엄|고급|Google|Microsoft/i;
  function voiceScore(v) {
    var n = v.name || '', s = 0;
    // Edge 의 Microsoft Online (Natural) 음성이 지금 브라우저로 얻을 수 있는 최고 음질이다 (네트워크 필요)
    if (/natural/i.test(n)) s += 7;
    else if (/premium|프리미엄/i.test(n)) s += 6;   // macOS 추가 다운로드 음성
    else if (/enhanced|고급/i.test(n)) s += 5;
    if (/^(Kyoko|Otoya|Hattori|O-ren)/.test(n)) s += 3;
    if (/Google|Microsoft (Nanami|Ayumi|Keita|Shiori|Daichi|Mayu|Naoki)/i.test(n)) s += 2;
    if (v['default']) s += 1;
    // 네트워크 음성은 카드마다 요청이 나가고 오프라인에서 죽는다. 로컬 고음질이 있으면 그쪽을 쓴다.
    if (v.localService === false) s -= 1;
    if (NOVELTY.test(n)) s -= 8;
    return s;
  }
  function voiceTag(v) {
    if (/natural/i.test(v.name)) return ' · 자연 음성' + (v.localService === false ? '(네트워크)' : '');
    if (/premium|프리미엄/i.test(v.name)) return ' · 프리미엄';
    if (/enhanced|고급/i.test(v.name)) return ' · 고급';
    if (NOVELTY.test(v.name)) return ' · 노벨티(권장 안 함)';
    return '';
  }
  function pickVoice() {
    var best = voices[0], bs = -99;
    for (var i = 0; i < voices.length; i++) {
      var sc = voiceScore(voices[i]);
      if (sc > bs) { bs = sc; best = voices[i]; }
    }
    return best.name;
  }
  if (SS) { SS.addEventListener ? SS.addEventListener('voiceschanged', loadVoices) : (SS.onvoiceschanged = loadVoices); }
  loadVoices();

  function utter(text) {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; u.volume = S.vol; u.rate = S.rate;
    for (var i = 0; i < voices.length; i++) if (voices[i].name === S.voice) { u.voice = voices[i]; break; }
    return u;
  }
  /* 발화를 큐에 몰아넣으면 단어와 예문이 숨도 안 쉬고 붙어 나와 어디서 예문이 시작되는지 모른다.
     Web Speech 에는 쉼 API 가 없어서 onend 뒤에 타이머로 끊는다.
     seq: 카드가 바뀌면 대기 중인 다음 발화를 버린다 (SS.cancel 만으로는 타이머가 남는다). */
  var speakSeq = 0, gapT = 0;
  // 대기 중인 다음 발화만 버린다. 카드가 넘어갔는데 이전 카드 예문이 뒤늦게 나오면 안 된다.
  function dropPending() {
    speakSeq++;
    if (gapT) { clearTimeout(gapT); gapT = 0; }
  }
  function stopSpeak() {
    dropPending();
    if (clipA) { try { clipA.pause(); } catch (e) {} clipA = null; }
    if (SS) { try { SS.cancel(); } catch (e) {} }
  }
  function speakChain(items, seq) {
    if (!items.length || seq !== speakSeq) return;
    var u = utter(items[0]);
    u.onend = u.onerror = function () {
      if (seq !== speakSeq || items.length < 2) return;
      gapT = setTimeout(function () { gapT = 0; speakChain(items.slice(1), seq); }, S.ttsGap);
    };
    try { SS.speak(u); } catch (e) {}
  }
  /* ---------------- かな 번들 음원 ----------------
     Gemini TTS 로 미리 뜬 131음이 assets/audio/ 에 있다. 기기 TTS 보다 나은 이유가 두 가지다:
     목소리가 한 결이고(요청마다 튀지 않는다), 낱 음절이 잘리지 않는다 — macOS Kyoko 는 あ 를 0.12초로
     끊어 낸다. 음원이 없으면 기존 TTS 로 떨어진다.
     fetch 는 file:// 에서 막히므로(절대 규칙 1) 반드시 new Audio() 로 읽는다. */
  var clipA = null;
  function kanaClip(text) {
    if (!KANA || !text) return null;
    var m = KANA.i[text];                       // 한 글자만 — 문장(기사 제목)은 걸리지 않는다
    return m && m.r ? 'assets/audio/' + encodeURIComponent(m.r) + '.opus' + DATA_V : null;
  }
  /* 기사 줄 음원. i = 0 이 제목, 1부터 문장 (artRows 와 같은 순서).
     매니페스트에 없는 기사는 null — 그 기사는 제목도 문장도 전부 기기 TTS 로 읽는다. */
  function readClip(w, i) {
    if (!w || w.kind !== 'r' || !w.i) return null;
    var n = AUD[w.i];
    if (!n || i == null || i < 0 || i >= n) return null;
    return 'assets/audio/read/' + encodeURIComponent(w.i) + '-' + i + '.opus' + DATA_V;
  }
  function playClip(url, text) {
    var a = new Audio(url);
    clipA = a;
    a.volume = S.vol;
    a.playbackRate = S.rate;
    // 파일이 없거나 코덱을 못 읽으면 조용히 죽지 말고 기기 TTS 로 넘긴다
    a.onerror = function () {
      if (clipA !== a) return;
      clipA = null;
      if (SS && voices.length) speakChain([text], speakSeq);
    };
    a.onended = function () { if (clipA === a) clipA = null; };
    try { a.play()['catch'](function () {}); } catch (e) {}
  }
  function speakOne(text) {
    if (!S.tts || !text) return;
    var clip = kanaClip(text);
    if (clip) { stopSpeak(); playClip(clip, text); return; }
    if (!SS || !voices.length) return;
    stopSpeak();
    speakChain([text], speakSeq);
  }
  function speak() {
    if (!SS || !S.tts || !voices.length) return;
    var w = current(); if (!w) return;
    // かな 카드는 답하기 전에 읽어주면 정답을 알려주는 셈이다
    if (w.kind === 'n') { if (drillShown || drillDone) speakOne(w.c); return; }
    if (w.kind === 'r') {                             // 카드를 넘기면 제목. 본문은 문장을 눌러서 듣는다
      var rc = readClip(w, 0);
      if (rc) { stopSpeak(); playClip(rc, w.tk); return; }
      speakOne(w.tk);
      return;
    }
    stopSpeak();
    // 한자 한 글자는 음성이 읽기를 고를 수 없다 (日 = ニチ? ひ?). 대표 단어를 읽어 준다.
    if (w.kind === 'k') {
      var q2 = [];
      for (var i = 0; i < w.ex.length && q2.length < (S.ttsEx ? 3 : 1); i++) q2.push(w.ex[i][1]);
      if (q2.length) speakChain(S.ttsTwice ? [q2[0]].concat(q2) : q2, speakSeq);
      return;
    }
    var t = w.k || w.w, q = [t];
    if (S.ttsTwice) q.push(t);
    if (S.ttsEx && (w.ek || w.e)) q.push(w.ek || w.e);
    speakChain(q, speakSeq);
  }
  // 예문만 읽기. ek(かな)를 먼저 쓴다 — 한자 표기는 음성이 읽기를 틀릴 수 있다.
  function speakEx() {
    if (!SS || !S.tts || !voices.length) return;
    var w = current(); if (!w || !(w.ek || w.e)) return;
    stopSpeak();
    speakChain([w.ek || w.e], speakSeq);
  }

  /* ---------------- 화면 절전 방지 ---------------- */
  var wl = null;
  function lockScreen() {
    if (!('wakeLock' in navigator) || wl || !playing || document.hidden) return;
    try {
      navigator.wakeLock.request('screen').then(function (s) {
        wl = s; s.addEventListener('release', function () { wl = null; });
      })['catch'](function () {});
    } catch (e) {}
  }
  function releaseScreen() { if (wl) { try { wl.release(); } catch (e) {} wl = null; } }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && playing) lockScreen(); });

  /* ---------------- 유휴 페이드 ---------------- */
  var idleT = 0;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function () {
      if (playing && panel.dataset.open !== '1' && help.dataset.open !== '1') document.body.classList.add('idle');
    }, 3000);
  }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, wake, { passive: true });
  });

  /* ---------------- 전체화면 ---------------- */
  // Safari 는 아직 webkit 접두사만 지원한다. 접두사를 안 보면 F 가 아무 일도 안 하는 것처럼 보인다.
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function toggleFs() {
    try {
      var el = document.documentElement;
      if (!fsEl()) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) { var p = req.call(el); if (p && p['catch']) p['catch'](function () {}); }
      } else {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) ex.call(document);
      }
    } catch (e) {}
  }
  function onFsChange() {
    document.documentElement.dataset.fs = fsEl() ? '1' : '0';
    clearTimeout(fitT); fitT = setTimeout(fit, 60);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* ---------------- 컨트롤 ---------------- */
  $('btnPlay').onclick = function () { setPlaying(!playing); };
  $('btnPrev').onclick = function () { go(-1); };
  $('btnNext').onclick = function () { go(1); };
  $('btnFirst').onclick = function () { idx = 0; elapsed = 0; markSeen(); paint(); if (S.ttsAuto) speak(); };
  $('btnSpeak').onclick = speak;
  cWord.onclick = speak;
  // 예문 블록 클릭 = 예문 읽기. 드래그로 문장을 선택하는 중이면 읽지 않는다.
  cEx.onclick = function () {
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return;
    speakEx();
  };
  $('btnMask').onclick = reveal;
  $('btnFs').onclick = toggleFs;
  $('btnFav').onclick = function () {
    var w = current(); if (!w) return;
    var k = uid(w);
    if (FAV[k]) delete FAV[k]; else FAV[k] = 1;
    dirty = true; flush();
    if (S.deck === 'fav' && !FAV[k]) buildDeck(); else paintChrome();
    paintStats();
  };

  function openPanel(v) {
    panel.dataset.open = v ? '1' : '0';
    $('btnSet').setAttribute('aria-expanded', v ? 'true' : 'false');
    if (!v) { wake(); focusDrill(); return; }
    document.body.classList.remove('idle'); kanaIn.blur();
    // 글꼴 타일은 여기서 처음 만든다 — 미리보기 글자 하나가 그 글꼴 파일을 통째로 받아 온다(6종 155KB).
    drawFonts();
    drawKanaHint();
    // 급수·한자음 개수는 실제 덱을 세어 보여 준다. 시작 화면에서 열었으면 여기서 덱이 온다.
    need(S.set, function () { drawSet(); drawLevels(); drawTier(); drawStudy(); });
  }
  $('btnSet').onclick = function () { openPanel(panel.dataset.open !== '1'); };
  $('btnSetClose').onclick = function () { openPanel(false); };
  $('btnEmptyFix').onclick = function () {
    if (S.set === 'kana' && ALL_N.length) openKanaPick(true); else openPanel(true);
  };
  function openHelp(v) {
    help.dataset.open = v ? '1' : '0';
    if (v) { document.body.classList.remove('idle'); kanaIn.blur(); } else { wake(); focusDrill(); }
  }
  $('btnHelp').onclick = function () { openHelp(true); };
  $('btnHelpClose').onclick = function () { openHelp(false); };
  help.onclick = function (e) { if (e.target === help) openHelp(false); };

  /* ---------------- 키보드 ---------------- */
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    // 설정·도움말·글자 고르기가 열려 있으면 카드 조작 키를 먹지 않는다.
    // 안 그러면 Space 가 포커스된 스위치의 기본 동작을 preventDefault 로 막아버리고,
    // 1·2·3 은 패널에 덮여 보이지도 않는 카드를 채점해 버린다.
    if (panel.dataset.open === '1' || help.dataset.open === '1' || kanaPick.dataset.open === '1') {
      if (e.key === 'Escape') { openPanel(false); openHelp(false); openKanaPick(false); }
      return;
    }
    // 한글 입력 상태에서는 e.key 가 'ㄹ'(f), 'ㄴ'(s), 'ㅍ'(v), 'ㅁ'(m) 으로 온다.
    // 그래서 e.key 가 ASCII 가 아닐 때만 물리 키(e.code)로 폴백한다 —
    // 이 순서라야 Dvorak 같은 배열에서도 눌린 글자 그대로 동작한다.
    var raw = e.key || '';
    var letter = /^[a-zA-Z]$/.test(raw) ? raw.toLowerCase()
      : (/^Key[A-Z]$/.test(e.code || '') ? e.code.charAt(3).toLowerCase() : '');
    var digit = /^[0-9]$/.test(raw) ? raw
      : (/^(Digit|Numpad)[0-9]$/.test(e.code || '') ? e.code.slice(-1) : '');

    if (screen === 'done') {
      if (raw === 'Enter') { e.preventDefault(); $('btnRetryMiss').click(); }
      else if (letter === 'h') { e.preventDefault(); goHome(); }
      else if (letter === 'f') { e.preventDefault(); toggleFs(); }
      else if (raw === '?') openHelp(help.dataset.open !== '1');
      return;
    }
    // 시작 화면에서는 카드 조작 키가 가리키는 카드가 없다
    if (screen === 'home') {
      if (letter === 'h' || raw === 'Enter') { e.preventDefault(); enterMode(S.set); }
      else if (raw === '?') openHelp(help.dataset.open !== '1');
      else if (letter === 'f') { e.preventDefault(); toggleFs(); }
      return;
    }

    switch (raw) {
      case ' ': case 'Spacebar': e.preventDefault(); setPlaying(!playing); return;
      case 'ArrowLeft': e.preventDefault(); go(-1); return;
      case 'ArrowRight': e.preventDefault(); go(1); return;
      case 'ArrowUp': e.preventDefault(); reveal(); return;
      case 'Escape': openPanel(false); openHelp(false); return;
      case '?': openHelp(help.dataset.open !== '1'); return;
    }
    if (digit === '1') { e.preventDefault(); grade(0); }
    else if (digit === '2') { e.preventDefault(); grade(1); }
    else if (digit === '3') { e.preventDefault(); grade(2); }
    else if (letter === 's') { e.preventDefault(); $('btnFav').click(); }
    else if (letter === 'm') { e.preventDefault(); toggleMute(); }
    else if (letter === 'v') { e.preventDefault(); speak(); }
    else if (letter === 'f') { e.preventDefault(); toggleFs(); }
    else if (letter === 'h') { e.preventDefault(); if (screen === 'home') enterMode(S.set); else goHome(); }
    else if (letter === 'k' && S.set === 'reading') { e.preventDefault(); toggleAllKo(); }
    else if (letter === 'r' && S.set === 'reading') { e.preventDefault(); toggleFuri(); }
    else if (letter === 'o' && S.set === 'reading') { e.preventDefault(); toggleOne(); }
  });

  /* ---------------- 스와이프 ---------------- */
  var tx = 0, ty = 0;
  stage.addEventListener('touchstart', function (e) {
    if (!e.touches[0]) return; tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    var t = e.changedTouches[0]; if (!t) return;
    var dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------------- 설정 위젯 ---------------- */
  function sw(id, key, after) {
    var el = $(id);
    function draw() { el.setAttribute('aria-checked', S[key] ? 'true' : 'false'); }
    el.onclick = function () { S[key] = !S[key]; draw(); save(); if (after) after(); };
    draw();
    return draw;
  }
  function rng(id, valId, key, fmt, scale, after) {
    var el = $(id), out = $(valId);
    el.value = String(Math.round(S[key] * scale));
    out.textContent = fmt(S[key]);
    el.oninput = function () {
      S[key] = Number(el.value) / scale;
      out.textContent = fmt(S[key]); save(); if (after) after();
    };
  }

  rng('rSec', 'vSec', 'sec', function (v) { return v + '초'; }, 1, function () { if (elapsed > S.sec * 1000) elapsed = 0; });
  rng('rHideDelay', 'vHideDelay', 'hideDelay', function (v) { return v + '초'; }, 1);
  rng('rVol', 'vVol', 'vol', function (v) { return Math.round(v * 100) + '%'; }, 100);
  rng('rRate', 'vRate', 'rate', function (v) { return v.toFixed(2) + '배'; }, 100);
  rng('rGap', 'vGap', 'ttsGap', function (v) { return v ? (v / 1000).toFixed(1) + '초' : '없음'; }, 1);

  sw('swShuffle', 'shuffle', function () { var w = current(); buildDeck(w && uid(w)); });
  sw('swHide', 'hide', function () { revealed = !S.hide; meanWrap.classList.toggle('masked', !revealed); });
  /* 음소거: 설정의 '발음 사용' 스위치와 같은 값(S.tts)을 공유한다.
     상태를 둘로 나누면 서로 어긋나므로 조작 경로만 둘로 둔다. */
  var drawTts = sw('swTts', 'tts', function () { syncMute(); paintChrome(); });
  function syncMute() {
    var muted = !S.tts;
    $('icMute').setAttribute('d', muted ? ICON_MUTED : ICON_SOUND);
    $('btnMute').setAttribute('aria-pressed', muted ? 'true' : 'false');
    $('btnMute').setAttribute('aria-label', muted ? '음소거 해제' : '음소거');
    $('btnMute').title = (muted ? '음소거 해제' : '음소거') + ' (M)';
    $('btnMute').classList.toggle('on', muted);
    $('btnMute').disabled = !SS || !voices.length;
  }
  function toggleMute() {
    if (!SS || !voices.length) return;
    S.tts = !S.tts; save();
    if (!S.tts) stopSpeak();   // 재생 중인 발화와 대기 중인 다음 발화를 즉시 끊는다
    drawTts(); syncMute(); paintChrome();
    toast(S.tts ? '소리 켜짐' : '음소거');
  }
  $('btnMute').onclick = toggleMute;
  syncMute();
  sw('swAuto', 'ttsAuto');
  sw('swTwice', 'ttsTwice');
  sw('swExSpeak', 'ttsEx');
  sw('swShowEx', 'showEx', paint);
  sw('swShowExH', 'showExH', paint);
  sw('swLongVowel', 'longVowel', paint);
  sw('swTsuCh', 'tsuCh', paint);
  sw('swShowEn', 'showEn', paint);
  sw('swKanaH', 'kanaShowH', function () { if (drillShown || drillDone) drawAnswerLine(drillShown); });

  rng('rBatch', 'vBatch', 'batchSize', function (v) { return v + '단어'; }, 1);
  rng('rTries', 'vTries', 'kanaTries', function (v) { return v + '번 틀리면'; }, 1);

  function drawSet() {
    var nk = nKanji(), nr = nRead(), nw = nWords();
    each($('setChips').children, function (b) {
      b.classList.toggle('on', b.dataset.set === S.set);
      b.setAttribute('aria-pressed', b.dataset.set === S.set ? 'true' : 'false');
      b.disabled = (b.dataset.set === 'kanji' && !nk) || (b.dataset.set === 'kana' && !ALL_N.length)
        || (b.dataset.set === 'reading' && !nr);
    });
    // 한자음 필터·급수·학습 모드·재생 간격은 단어 덱 전용이다
    $('tierChips').parentNode.hidden = S.set !== 'words';
    $('lvChips').parentNode.hidden = S.set === 'kana' || S.set === 'reading';
    $('studyChips').parentNode.hidden = S.set === 'kana' || S.set === 'reading';
    $('grpKana').hidden = !ALL_N.length;
    $('grpRead').hidden = !nr;
    $('readHint').textContent = nr
      ? '기사는 ウィキニュース(ja.wikinews.org) 에서 왔고 CC BY 4.0 입니다. 문장을 누르면 그 문장만 읽어 줍니다.'
      : 'data/reading.js 가 없어 읽기 모드를 쓸 수 없습니다.';
    $('setHint').textContent =
      S.set === 'reading' ? 'ウィキニュース 기사 ' + nr + '편. 한자 위에 かな 가 붙고, 문장마다 번역과 발음이 있습니다.'
      : S.set === 'kana' ? 'かな ' + ALL_N.length + '자. 글자가 뜨면 로마자로 칩니다. 맞는 순간 다음 글자로 넘어갑니다.'
      : S.set === 'kanji'
        ? (nk ? '한자 ' + nk + '자. 한 글자마다 한국 한자음·훈음·음독·훈독과 그 한자를 쓰는 단어를 보여줍니다. 단어 덱에 실제로 등장하는 한자만 있습니다.'
              : 'data/kanji.js 가 없어 한자 카드를 쓸 수 없습니다.')
        : '단어 ' + nw + '개. 지금까지의 동작 그대로입니다.';
  }
  each($('setChips').children, function (b) {
    b.onclick = function () {
      if (b.dataset.set === S.set) return;
      stopSpeak();
      need(b.dataset.set, function () {
        useSet(b.dataset.set);
        screen = 'study';
        drawSet(); drawStudy(); drawLevels(); drawTier(); buildDeck();
        setPlaying(S.set !== 'kana' && S.set !== 'reading' && deck.length > 0);
      });
    };
  });

  function drawStudy() {
    each($('studyChips').children, function (b) {
      b.classList.toggle('on', b.dataset.study === S.study);
      b.setAttribute('aria-pressed', b.dataset.study === S.study ? 'true' : 'false');
    });
    $('batchWrap').hidden = S.study !== 'batch';
    $('grades').hidden = S.study === 'all';
    var due = dueCount(), graded = Object.keys(SRS).length;
    $('studyHint').textContent =
      S.study === 'all' ? '지금까지의 동작 그대로. 선택한 급수 전체를 셔플해 계속 재생합니다. 배경 재생용.'
      : S.study === 'batch' ? '적은 수의 단어만 돌려서 노출 간격을 좁힙니다. ' + S.batchSize + '단어 × ' + S.sec + '초 = 한 바퀴 ' + Math.round(S.batchSize * S.sec / 60) + '분. 작업 중 틀어두기에 이 모드가 실제로 남습니다.'
      : '채점한 카드를 복습 시점에 맞춰 다시 꺼냅니다. 채점 ' + graded + '개, 지금 복습 대상 ' + due + '개. 1·2·3 으로 채점하세요.';
  }
  each($('studyChips').children, function (b) {
    b.onclick = function () {
      S.study = b.dataset.study; save();
      var w = current(); drawStudy(); buildDeck(w && uid(w));
    };
  });
  $('rBatch').addEventListener('change', function () { if (S.study === 'batch') { makeBatch(currentPool()); buildDeck(); } drawStudy(); });
  $('btnNewBatch').onclick = function () {
    makeBatch(currentPool());
    buildDeck(); drawStudy(); toast('새 배치 ' + BATCH.ids.length + '단어');
  };
  function drawTier() {
    each($('tierChips').children, function (b) {
      b.classList.toggle('on', b.dataset.tier === S.tier);
      b.setAttribute('aria-pressed', b.dataset.tier === S.tier ? 'true' : 'false');
    });
    if (S.set !== 'words') return;                 // 한자음 필터는 단어 덱 전용이다 (칩 묶음도 숨겨져 있다)
    if (!ALL_W.length) { $('tierHint').textContent = '단어 덱을 불러오면 개수가 나옵니다.'; return; }
    var set = {}; activeLevels().forEach(function (n) { set[n] = 1; });
    var same = 0, diff = 0, kana = 0;
    each(ALL_W, function (w) {
      if (!set[w.lv]) return;
      if (!w.hj) kana++; else if (w.same) same++; else diff++;
    });
    $('tierHint').textContent =
      '선택 급수 기준 — 한자음=한국어 ' + same + ' · 한자음 다름 ' + diff + ' · かな ' + kana + '개. '
      + '한자음이 한국어와 같은 단어는 외울 게 없으니 빨리 훑고, 어긋나는 단어와 かな 단어에 시간을 쓰는 게 낫습니다.';
  }
  each($('tierChips').children, function (b) {
    b.onclick = function () {
      S.tier = b.dataset.tier; save();
      var w = current(); drawTier(); buildDeck(w && uid(w));
    };
  });
  sw('swFastSame', 'fastSame');
  drawTier();

  $('btnG0').onclick = function () { grade(0); };
  $('btnG1').onclick = function () { grade(1); };
  $('btnG2').onclick = function () { grade(2); };
  drawStudy();

  $('btnReshuffle').onclick = function () {
    S.shuffle = true; $('swShuffle').setAttribute('aria-checked', 'true');
    S.seed = (Math.random() * 4294967295) >>> 0 || 1; save(); buildDeck();
  };

  $('selVoice').onchange = function () { S.voice = this.value; save(); };

  // 급수 칩 - 런타임 데이터에서 유도. 학습 대상을 바꾸면 개수가 달라지므로 다시 그린다.
  function drawLevels() {
    if (S.set === 'kana' || S.set === 'reading') return;   // 급수 칩 묶음 자체가 숨겨져 있다
    var box = $('lvChips'), hint = $('lvHint');
    box.textContent = '';
    if (!LEVELS.length) {
      hint.textContent = '로드된 데이터가 없습니다. data 폴더에 words-n5.js 같은 파일을 넣으세요.';
      return;
    }
    var counts = lvCounts();
    LEVELS.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.dataset.lv = String(n);
      b.textContent = LV_LABEL[n] + ' ' + counts[n];
      b.onclick = function () {
        var cur = activeLevels();
        var i = cur.indexOf(n);
        if (i >= 0) { if (cur.length === 1) return; cur.splice(i, 1); } else cur.push(n);
        S.levels = cur.sort(function (a, b2) { return b2 - a; });
        save(); drawLv(); drawTier(); buildDeck();   // 한자음 개수는 '선택 급수 기준'이라 같이 다시 센다
      };
      box.appendChild(b);
    });
    var missing = [5, 4, 3, 2, 1].filter(function (n) { return LEVELS.indexOf(n) < 0; });
    hint.textContent = missing.length
      ? '현재 ' + missing.map(function (n) { return LV_LABEL[n]; }).join(', ') + ' 데이터는 없습니다. 파일을 추가하면 자동으로 나타납니다.'
      : 'N5부터 N1까지 모두 로드되었습니다.';
    drawLv();
  }
  drawLevels();
  drawSet();
  function drawLv() {
    var cur = activeLevels();
    each($('lvChips').children, function (b) {
      b.classList.toggle('on', cur.indexOf(Number(b.dataset.lv)) >= 0);
    });
  }

  // 덱 칩
  each(document.querySelectorAll('[data-deck]'), function (b) {
    b.onclick = function () { S.deck = b.dataset.deck; save(); drawDeckChips(); buildDeck(); };
  });
  function drawDeckChips() {
    each(document.querySelectorAll('[data-deck]'), function (b) {
      b.classList.toggle('on', b.dataset.deck === S.deck);
    });
  }

  // 테마 칩
  each(document.querySelectorAll('[data-theme]'), function (b) {
    b.onclick = function () { S.theme = b.dataset.theme; save(); applyTheme(); drawThemeChips(); };
  });
  var mqLight = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    var t = S.theme === 'auto' ? (mqLight && mqLight.matches ? 'light' : 'dark') : S.theme;
    document.documentElement.dataset.theme = t;
  }
  if (mqLight && mqLight.addEventListener) mqLight.addEventListener('change', function () { if (S.theme === 'auto') applyTheme(); });
  function drawThemeChips() {
    each(document.querySelectorAll('[data-theme]'), function (b) {
      b.classList.toggle('on', b.dataset.theme === S.theme);
    });
  }

  $('btnReset').onclick = function () {
    if (!confirm('즐겨찾기와 본 횟수를 모두 지울까요?')) return;
    FAV = {}; VIEWS = {}; dirty = true; flush();
    if (S.deck === 'fav') { S.deck = 'all'; save(); drawDeckChips(); }
    buildDeck(); paintStats();
  };
  function paintStats() {
    var f = 0, v = 0, k;
    for (k in FAV) if (FAV[k]) f++;
    for (k in VIEWS) v++;
    $('statHint').textContent = '즐겨찾기 ' + f + '개, 본 단어 ' + v + '개';
  }

  /* ---------------- 시작 화면 ---------------- */
  each($('pickRows').children, function (b) {
    b.onclick = function () { if (!b.disabled) enterMode(b.dataset.go); };
  });
  $('btnHome').onclick = goHome;
  $('btnMark').onclick = goHome;

  /* ---------------- かな 글자 고르기 ----------------
     열 하나가 버튼 하나다. 오십음도는 원래 행으로 외우고, 68열을 한 글자씩 켜게 하면 아무도 안 쓴다. */
  var kcolNodes = [], kgrpNodes = [];
  function buildKanaGrids() {
    var box = $('kanaGrids');
    box.textContent = '';
    kcolNodes = []; kgrpNodes = [];
    if (!KANA) return;
    KANA.g.forEach(function (g) {
      var sec = document.createElement('section'); sec.className = 'kgrp';
      var head = document.createElement('div'); head.className = 'kgrp-head';
      var h3 = document.createElement('h3'); h3.textContent = g.n;
      var cnt = document.createElement('span'); cnt.className = 'kgrp-n';
      var tgl = document.createElement('button');
      tgl.type = 'button'; tgl.className = 'btn'; tgl.textContent = '전체';
      head.appendChild(h3); head.appendChild(cnt); head.appendChild(tgl);

      var tbl = document.createElement('div'); tbl.className = 'ktable';
      var ids = [];
      g.c.forEach(function (cells, ci) {
        var id = g.k + ':' + ci;
        ids.push(id);
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'kcol'; b.dataset.col = id;
        var names = [];
        cells.forEach(function (ch) {
          var cell = document.createElement('span'); cell.className = 'kcell';
          if (ch) {
            var kb = document.createElement('b'); kb.textContent = ch;
            var ri = document.createElement('i'); ri.textContent = KANA.i[ch].r;
            cell.appendChild(kb); cell.appendChild(ri);
            names.push(ch);
          }
          b.appendChild(cell);
        });
        b.setAttribute('aria-label', names.join(' '));
        b.onclick = function () { toggleCols([id]); };
        tbl.appendChild(b);
        kcolNodes.push({ el: b, id: id });
      });
      tgl.onclick = function () {
        var allOn = ids.every(function (i) { return KCOLSET[i]; });
        toggleCols(ids, !allOn);
      };
      sec.appendChild(head); sec.appendChild(tbl);
      box.appendChild(sec);
      kgrpNodes.push({ cnt: cnt, ids: ids, total: KGRP_N[g.k] || 0 });
    });
  }
  function toggleCols(ids, force) {
    ids.forEach(function (id) {
      var on = force == null ? !KCOLSET[id] : force;
      var at = KCOLS.indexOf(id);
      if (on && at < 0) KCOLS.push(id);
      else if (!on && at >= 0) KCOLS.splice(at, 1);
    });
    syncKcols();
    drawKanaGrids();
  }
  function kanaSelN() {
    var n = 0;
    for (var i = 0; i < KCOLS.length; i++) n += KCOL_N[KCOLS[i]] || 0;
    return n;
  }
  /* 설정 시트의 かな 힌트 한 줄. 기록이 바뀔 때마다 갱신해야 하는데 표를 다시 그릴 이유는 없다 —
     그래서 표 그리기(drawKanaGrids)와 떼어 뒀다. */
  function drawKanaHint(sel) {
    if (sel == null) sel = kanaSelN();
    var rec = recLine();
    $('kanaHint').textContent = '선택 ' + sel + '자 · ' + KCOLS.length + '열. 히라가나 기본만 켠 상태가 기본값입니다.'
      + (rec ? '\n' + rec : '');
  }
  function drawKanaGrids() {
    kcolNodes.forEach(function (n) {
      var on = !!KCOLSET[n.id];
      n.el.classList.toggle('on', on);
      n.el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    kgrpNodes.forEach(function (g) {
      var on = 0;
      for (var i = 0; i < g.ids.length; i++) if (KCOLSET[g.ids[i]]) on += KCOL_N[g.ids[i]] || 0;
      g.cnt.textContent = on + ' / ' + g.total + '자';
    });
    var sel = kanaSelN();
    $('kanaPickHint').textContent = sel
      ? '선택 ' + sel + '자. 열을 눌러 켜고 끕니다.'
      : '열을 하나 이상 골라야 연습을 시작할 수 있습니다.';
    $('btnKanaStart').disabled = !sel;
    drawKanaHint(sel);
  }
  function openKanaPick(v) {
    kanaPick.dataset.open = v ? '1' : '0';
    if (v) { document.body.classList.remove('idle'); drawKanaGrids(); }
    else { wake(); focusDrill(); }
  }
  $('btnKanaPick').onclick = function () { openKanaPick(true); };
  $('btnKanaPick2').onclick = function () { openPanel(false); openKanaPick(true); };
  $('btnKanaAll').onclick = function () { toggleCols(kcolNodes.map(function (n) { return n.id; }), true); };
  $('btnKanaNone').onclick = function () { toggleCols(kcolNodes.map(function (n) { return n.id; }), false); };
  kanaPick.onclick = function (e) { if (e.target === kanaPick) openKanaPick(false); };
  $('btnKanaStart').onclick = function () {
    openKanaPick(false);
    useSet('kana'); screen = 'study';
    drawSet(); drawStudy(); drawLevels();
    buildDeck();
    setPlaying(false);
  };
  buildKanaGrids();
  drawKanaGrids();

  /* ---------------- かな 입력 ---------------- */
  kanaIn.addEventListener('input', drillInput);
  kanaIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (drillShown) drillSkip(); else showAnswer(); }
    else if (e.key === 'Escape') { e.preventDefault(); kanaIn.blur(); }
  });
  // 카드 어디를 눌러도 입력칸으로 돌아온다 — 포커스를 잃으면 타자 연습이 멈춘 것처럼 보인다
  stage.addEventListener('mousedown', function (e) {
    if (S.set !== 'kana' || screen !== 'study') return;
    if (e.target === kanaIn) return;
    setTimeout(focusDrill, 0);
  });
  $('btnKanaShow').onclick = function () { showAnswer(); focusDrill(); };
  $('btnKanaSkip').onclick = function () { drillSkip(); };
  $('btnKanaReset').onclick = function () {
    if (!confirm('かな 정답률 기록을 지울까요?')) return;
    KSTAT = {}; lsSet(K_KSTAT, KSTAT);
    KREC = { n: 0, ok: 0, ng: 0, perfect: 0, streak: 0, bestStreak: 0, best: -1, bestN: 0 };
    lsSet(K_KREC, KREC);
    roundOk = 0; roundNg = 0;
    toast('정답률과 바퀴 기록을 지웠습니다');
    drawKanaHint();
    paint();
  };

  /* ---------------- 읽기 토글 ---------------- */
  // 루비는 전부 かな 라 かな 전용 서브셋 글꼴을 그대로 쓸 수 있다 (한자가 없어도 상관없다)
  var RT_FONTS = {
    kosugi: '"Kosugi Maru","Noto Sans JP"',
    noto: '"Noto Sans JP"',
    yusei: '"Yusei Magic","Noto Sans JP"',
    dela: '"Dela Gothic One","Noto Sans JP"'
  };
  function applyFuri() {
    document.documentElement.dataset.furi = S.furi ? '1' : '0';
    document.documentElement.style.setProperty('--rt', S.rt + 'em');
    var f = RT_FONTS[S.rtFont] || RT_FONTS.kosugi;
    document.documentElement.style.setProperty('--f-rt', f + ',"Hiragino Maru Gothic ProN",system-ui,sans-serif');
    paintChrome();
  }
  function drawRtFontChips() {
    each($('rtFontChips').children, function (b) {
      var on = b.dataset.rtf === S.rtFont;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  each($('rtFontChips').children, function (b) {
    b.onclick = function () { S.rtFont = b.dataset.rtf; save(); applyFuri(); drawRtFontChips(); };
  });
  function drawRtChips() {
    each($('rtChips').children, function (b) {
      var on = Math.abs(Number(b.dataset.rt) - S.rt) < 0.001;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  each($('rtChips').children, function (b) {
    b.onclick = function () { S.rt = Number(b.dataset.rt); save(); applyFuri(); drawRtChips(); };
  });
  function toggleAllKo() { S.koAll = !S.koAll; save(); applyKoAll(); drawReadSw(); }
  function toggleFuri() { S.furi = !S.furi; save(); applyFuri(); drawReadSw(); }
  function toggleOne() {
    S.readOne = !S.readOne; save();
    drawReadSw(); paint();
  }
  $('btnAllKo').onclick = toggleAllKo;
  $('btnFuri').onclick = toggleFuri;
  $('btnOne').onclick = toggleOne;
  var drawOneSw = sw('swReadOne', 'readOne', paint);
  var drawFuriSw = sw('swFuri', 'furi', applyFuri);
  var drawKoSw = sw('swKoAll', 'koAll', applyKoAll);
  function drawReadSw() { drawFuriSw(); drawKoSw(); drawOneSw(); }

  /* ---------------- 글꼴 타일 ---------------- */
  function drawFonts() {
    var box = $('fontTiles');
    box.textContent = '';
    fontList().forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ftile' + (S.font === f.k ? ' on' : '');
      b.setAttribute('aria-pressed', S.font === f.k ? 'true' : 'false');
      var g = document.createElement('b');
      g.textContent = f.k === 'random' ? '？' : 'あ';
      if (f.f) g.style.fontFamily = f.f + ',' + JP_TAIL;
      var lab = document.createElement('span'); lab.textContent = f.n;
      b.appendChild(g); b.appendChild(lab);
      b.onclick = function () {
        S.font = f.k; save();
        applyFont(); drawFonts(); paint();
      };
      box.appendChild(b);
    });
    $('fontHint').textContent = S.font === 'random'
      ? 'かな 카드마다 글꼴이 바뀝니다. 단어·한자 카드는 기본 글꼴로 나옵니다.'
      : '번들 글꼴 6종은 かな 만 들어 있어 한자는 교과서체가 그립니다. 시스템 글꼴은 설치된 것만 보입니다.';
  }

  /* ---------------- 폰트 폴백 감지 (조용히) ---------------- */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      try {
        if (!document.fonts.check('1em "Klee One"')) document.documentElement.dataset.fontfallback = '1';
      } catch (e) {}
      fit();
    })['catch'](function () {});
  }

  /* ---------------- 부트 ----------------
     항상 시작 화면에서 출발한다 (사용자 요구). 덱도 글꼴 타일도 여기서는 안 만든다 —
     시작 화면은 개수표와 かな 만 있으면 그려지고, 나머지는 모드를 고를 때 온다. */
  applyTheme(); drawThemeChips(); drawDeckChips(); drawLv(); paintStats();
  applyFont(); applyFuri(); drawRtChips(); drawRtFontChips();
  screen = 'home';
  setPlaying(false);
  paint();
  wake();
  // 공유 링크로 들어온 경우만 시작 화면을 건너뛴다. 기본 부트 화면은 그대로 학습 선택이다.
  var bootRead = hashArticle();
  if (bootRead && nRead()) enterMode('reading', 'r-' + bootRead);
})();
