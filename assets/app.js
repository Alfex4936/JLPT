/* JLPT 낱말 셔플 - vanilla, 오프라인, file:// 동작
   외부 요청 0. 모듈 없음. 현재 카드만 렌더. */
(function () {
  'use strict';

  /* ---------------- 저장소 ---------------- */
  var K_SET = 'jlpt.settings.v1',
      K_FAV = 'jlpt.fav.v1',
      K_VIEW = 'jlpt.views.v1',
      K_POS = 'jlpt.pos.v1';

  function $(id) { return document.getElementById(id); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var DEFAULTS = {
    sec: 15, shuffle: true, seed: 1, levels: null, deck: 'all',
    hide: false, hideDelay: 5,
    tts: true, voice: '', vol: 0.9, rate: 1, ttsAuto: true, ttsTwice: false, ttsEx: false,
    showEx: true, showExH: true, longVowel: false, showEn: false, theme: 'dark',
    study: 'all', batchSize: 60, // study: all(기본, 지금까지의 동작) | batch | srs
    tier: 'all', fastSame: false, tsuCh: false // tier: all | same(한자음=한국어) | diff(한자음 다름) | kana(한자 없음)
  };
  var S = (function () {
    var saved = lsGet(K_SET, {}) || {}, o = {};
    for (var k in DEFAULTS) o[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULTS[k];
    o.sec = Math.min(60, Math.max(3, Number(o.sec) || 15));
    o.hideDelay = Math.min(30, Math.max(1, Number(o.hideDelay) || 5));
    o.vol = Math.min(1, Math.max(0, Number(o.vol)));
    o.rate = Math.min(1.5, Math.max(0.5, Number(o.rate) || 1));
    if (!Array.isArray(o.levels)) o.levels = null;
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

  /* ---------------- 데이터 ---------------- */
  var RAW = Array.isArray(window.JLPT) ? window.JLPT : [];
  var ALL = [];
  for (var r = 0; r < RAW.length; r++) {
    var it = RAW[r];
    if (!it || typeof it !== 'object') continue;
    if (!it.w || !it.k) continue;
    var lvn = Number(it.lv);
    if (!(lvn >= 1 && lvn <= 5)) continue;
    it.lv = lvn;
    ALL.push(it);
  }
  var LEVELS = (function () {
    var seen = {}, out = [];
    for (var i = 0; i < ALL.length; i++) if (!seen[ALL[i].lv]) { seen[ALL[i].lv] = 1; out.push(ALL[i].lv); }
    return out.sort(function (a, b) { return b - a; }); // N5 먼저
  })();
  function uid(w) { return w.lv + '-' + (w.i != null ? w.i : w.w); }

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
    var set = {}; activeLevels().forEach(function (n) { set[n] = 1; });
    var pool = ALL.filter(function (w) { return set[w.lv]; });
    if (S.deck === 'fav') pool = pool.filter(function (w) { return FAV[uid(w)]; });
    return pool.filter(tierOk);
  }

  function buildDeck(keepUid) {
    var pool = currentPool();

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
      bar = $('bar'), counter = $('counter'), deckinfo = $('deckinfo'),
      panel = $('panel'), help = $('help'), icPlay = $('icPlay'),
      starGlyph = $('starGlyph'), btnFav = $('btnFav');

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

  var ICON_PLAY = 'M7 4v16l13-8z';
  var ICON_PAUSE = 'M7 4h4v16H7zm6 0h4v16h-4z';
  // 스피커 + 음파 / 스피커 + 사선(음소거)
  var ICON_SOUND = 'M4 9v6h3l5 4V5L7 9H4zm11.5.5a4 4 0 010 5v-5zm1.8-2.3a7 7 0 010 9.6l1.1 1.1a8.5 8.5 0 000-11.8l-1.1 1.1z';
  var ICON_MUTED = 'M4 9v6h3l5 4V5L7 9H4zm14.6 0L17.2 7.6 15 9.8l-2.2-2.2v2.1l1.1 1.1-1.1 1.1v2.1L15 14.2l2.2 2.2 1.4-1.4-2.2-2.2 2.2-2.2-1.4-1.4z';

  /* ---------------- 렌더 ---------------- */
  var revealed = false;
  var LV_LABEL = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };
  var HANGUL = /^(.+?)([가-힣]+)$/;

  function current() { return deck.length ? deck[idx] : null; }

  // 표기법은 つ 를 '쓰'로 적는다(쓰나미·마쓰다). 실제 발음은 [tsɯ] 라 '츠'가 더 가깝다는 사람이 많아 옵션.
  // 출력에서 '쓰'는 つ/ツ 에서만 나오므로(kana2hangul 표 참조) 단순 치환이 정확하다.
  function pron(s) { return S.tsuCh && s ? s.replace(/쓰/g, '츠') : s; }

  function paint() {
    var w = current();
    var has = !!w;
    card.hidden = !has;
    empty.hidden = has;
    if (!has) { paintEmpty(); paintChrome(); return; }

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

  function paintChrome() {
    var w = current();
    counter.textContent = deck.length ? (idx + 1) + ' / ' + deck.length : '0 / 0';
    var lvTxt = activeLevels().map(function (n) { return LV_LABEL[n]; }).join(' ');
    deckinfo.textContent = '';
    if (ALL.length) {
      var modeTxt = S.study === 'batch' ? '배치 루프' : S.study === 'srs' ? '복습' : (S.deck === 'fav' ? '즐겨찾기' : '전체');
      if (S.tier !== 'all') modeTxt += ' · ' + TIER_LABEL[S.tier];
      [lvTxt || '급수 없음',
       modeTxt + ' ' + deck.length + '단어',
       S.study === 'srs' ? '복습 대상 ' + dueCount() + '개' : (S.shuffle ? '셔플' : '순서대로')].forEach(function (s) {
        var el = document.createElement('span'); el.textContent = s; deckinfo.appendChild(el);
      });
    }
    var fav = w ? !!FAV[uid(w)] : false;
    btnFav.setAttribute('aria-pressed', fav ? 'true' : 'false');
    starGlyph.textContent = fav ? '★' : '☆';
    btnFav.disabled = !w;
    $('btnSpeak').disabled = !w || !S.tts || !voices.length;
  }

  // 카드가 화면을 넘지 않게 맞춘다. 세로(전체 스케일) 먼저, 그다음 표기 가로 폭.
  var fitT = 0;
  function fit() {
    card.style.removeProperty('--scale');
    cWord.style.fontSize = '';
    if (card.hidden) return;

    var base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    var sp = getComputedStyle(stage);
    var avail = stage.clientHeight - parseFloat(sp.paddingTop) - parseFloat(sp.paddingBottom);
    var s = base, guard = 0;
    while (avail > 40 && card.getBoundingClientRect().height > avail && s > 0.5 && guard++ < 22) {
      s *= 0.94; card.style.setProperty('--scale', s);
    }

    var box = card.clientWidth;
    var size = parseFloat(getComputedStyle(cWord).fontSize) || 48, g2 = 0;
    while (box && cWord.scrollWidth > box && size > 14 && g2++ < 24) {
      size *= 0.92; cWord.style.fontSize = size + 'px';
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
    idx += delta;
    if (idx >= deck.length) {
      idx = 0;
      if (S.shuffle) { S.seed = (S.seed * 1103515245 + 12345) >>> 0 || 1; save(); deck = shuffled(deck, S.seed); }
    }
    if (idx < 0) idx = deck.length - 1;
    elapsed = 0;
    markSeen(); paint();
    if (S.ttsAuto || manual === 'speak') speak();
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
      markSeen(); paint(); if (S.ttsAuto) speak();
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
    if (v) { wake(); lockScreen(); } else { document.body.classList.remove('idle'); releaseScreen(); }
  }

  /* ---------------- 타이머 (rAF 단일 루프) ---------------- */
  var last = 0;
  function tick(t) {
    requestAnimationFrame(tick);
    var dt = last ? Math.min(t - last, 250) : 0;
    last = t;
    if (!playing || !deck.length) return;
    elapsed += dt;
    // 배지 단어는 이미 아는 단어라 빨리 넘겨도 된다 (옵션)
    var cw = current();
    var dur = S.sec * 1000 * (S.fastSame && cw && cw.same ? 0.5 : 1);
    bar.style.transform = 'scaleX(' + Math.min(elapsed / dur, 1) + ')';
    if (!revealed && elapsed >= S.hideDelay * 1000) reveal();
    if (elapsed >= dur) go(1);
  }
  requestAnimationFrame(tick);

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
  var HAS_GOOD = /premium|enhanced|프리미엄|고급|Google|Microsoft|Siri/i;
  function voiceScore(v) {
    var n = v.name || '', s = 0;
    if (/premium|프리미엄/i.test(n)) s += 6;        // macOS 추가 다운로드 음성이 음질 차이가 가장 크다
    else if (/enhanced|고급/i.test(n)) s += 5;
    if (/^(Kyoko|Otoya|Hattori|O-ren)/.test(n)) s += 3;
    if (/Google|Microsoft (Nanami|Ayumi|Keita)/i.test(n)) s += 2;
    if (v['default']) s += 1;
    if (NOVELTY.test(n)) s -= 8;
    return s;
  }
  function voiceTag(v) {
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
  function speak() {
    if (!SS || !S.tts || !voices.length) return;
    var w = current(); if (!w) return;
    try {
      SS.cancel();
      var t = w.k || w.w;
      SS.speak(utter(t));
      if (S.ttsTwice) SS.speak(utter(t));
      if (S.ttsEx && (w.ek || w.e)) SS.speak(utter(w.ek || w.e));
    } catch (e) {}
  }
  // 예문만 읽기. ek(かな)를 먼저 쓴다 — 한자 표기는 음성이 읽기를 틀릴 수 있다.
  function speakEx() {
    if (!SS || !S.tts || !voices.length) return;
    var w = current(); if (!w || !(w.ek || w.e)) return;
    try { SS.cancel(); SS.speak(utter(w.ek || w.e)); } catch (e) {}
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
    if (v) { document.body.classList.remove('idle'); } else wake();
  }
  $('btnSet').onclick = function () { openPanel(panel.dataset.open !== '1'); };
  $('btnSetClose').onclick = function () { openPanel(false); };
  $('btnEmptyFix').onclick = function () { openPanel(true); };
  function openHelp(v) { help.dataset.open = v ? '1' : '0'; if (v) document.body.classList.remove('idle'); else wake(); }
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
    // 설정·도움말이 열려 있으면 카드 조작 키를 먹지 않는다.
    // 안 그러면 Space 가 포커스된 스위치의 기본 동작을 preventDefault 로 막아버리고,
    // 1·2·3 은 패널에 덮여 보이지도 않는 카드를 채점해 버린다.
    if (panel.dataset.open === '1' || help.dataset.open === '1') {
      if (e.key === 'Escape') { openPanel(false); openHelp(false); }
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
    if (!S.tts) { try { SS.cancel(); } catch (e) {} }   // 재생 중인 발화도 즉시 끊는다
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

  rng('rBatch', 'vBatch', 'batchSize', function (v) { return v + '단어'; }, 1);

  function drawStudy() {
    Array.prototype.forEach.call($('studyChips').children, function (b) {
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
  Array.prototype.forEach.call($('studyChips').children, function (b) {
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
    Array.prototype.forEach.call($('tierChips').children, function (b) {
      b.classList.toggle('on', b.dataset.tier === S.tier);
      b.setAttribute('aria-pressed', b.dataset.tier === S.tier ? 'true' : 'false');
    });
    var set = {}; activeLevels().forEach(function (n) { set[n] = 1; });
    var pool = ALL.filter(function (w) { return set[w.lv]; });
    var same = 0, diff = 0, kana = 0;
    pool.forEach(function (w) { if (!w.hj) kana++; else if (w.same) same++; else diff++; });
    $('tierHint').textContent =
      '선택 급수 기준 — 한자음=한국어 ' + same + ' · 한자음 다름 ' + diff + ' · かな ' + kana + '개. '
      + '한자음이 한국어와 같은 단어는 외울 게 없으니 빨리 훑고, 어긋나는 단어와 かな 단어에 시간을 쓰는 게 낫습니다.';
  }
  Array.prototype.forEach.call($('tierChips').children, function (b) {
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

  // 급수 칩 - 런타임 데이터에서 유도
  (function () {
    var box = $('lvChips'), hint = $('lvHint');
    if (!LEVELS.length) {
      hint.textContent = '로드된 데이터가 없습니다. data 폴더에 words-n5.js 같은 파일을 넣으세요.';
      return;
    }
    var counts = {};
    ALL.forEach(function (w) { counts[w.lv] = (counts[w.lv] || 0) + 1; });
    LEVELS.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.dataset.lv = String(n);
      b.textContent = LV_LABEL[n] + ' ' + counts[n];
      b.onclick = function () {
        var cur = activeLevels();
        var i = cur.indexOf(n);
        if (i >= 0) { if (cur.length === 1) return; cur.splice(i, 1); } else cur.push(n);
        S.levels = cur.sort(function (a, b2) { return b2 - a; });
        save(); drawLv(); buildDeck();
      };
      box.appendChild(b);
    });
    var missing = [5, 4, 3, 2, 1].filter(function (n) { return LEVELS.indexOf(n) < 0; });
    hint.textContent = missing.length
      ? '현재 ' + missing.map(function (n) { return LV_LABEL[n]; }).join(', ') + ' 데이터는 없습니다. 파일을 추가하면 자동으로 나타납니다.'
      : 'N5부터 N1까지 모두 로드되었습니다.';
  })();
  function drawLv() {
    var cur = activeLevels();
    Array.prototype.forEach.call($('lvChips').children, function (b) {
      b.classList.toggle('on', cur.indexOf(Number(b.dataset.lv)) >= 0);
    });
  }

  // 덱 칩
  Array.prototype.forEach.call(document.querySelectorAll('[data-deck]'), function (b) {
    b.onclick = function () { S.deck = b.dataset.deck; save(); drawDeckChips(); buildDeck(); };
  });
  function drawDeckChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-deck]'), function (b) {
      b.classList.toggle('on', b.dataset.deck === S.deck);
    });
  }

  // 테마 칩
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
    b.onclick = function () { S.theme = b.dataset.theme; save(); applyTheme(); drawThemeChips(); };
  });
  var mqLight = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    var t = S.theme === 'auto' ? (mqLight && mqLight.matches ? 'light' : 'dark') : S.theme;
    document.documentElement.dataset.theme = t;
  }
  if (mqLight && mqLight.addEventListener) mqLight.addEventListener('change', function () { if (S.theme === 'auto') applyTheme(); });
  function drawThemeChips() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme]'), function (b) {
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

  /* ---------------- 폰트 폴백 감지 (조용히) ---------------- */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      try {
        if (ALL.length && !document.fonts.check('1em "Klee One"')) document.documentElement.dataset.fontfallback = '1';
      } catch (e) {}
      fit();
    })['catch'](function () {});
  }

  /* ---------------- 부트 ---------------- */
  applyTheme(); drawThemeChips(); drawDeckChips(); drawLv(); paintStats();
  buildDeck(lsGet(K_POS, null));
  setPlaying(ALL.length > 0);
  markSeen(); paint();
  wake();
})();
