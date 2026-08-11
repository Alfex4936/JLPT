# AGENTS.md

이 저장소에서 작업하는 에이전트용 지침. 사람이 읽을 문서는 [README.md](README.md), 데이터·UI 스펙은 [SPEC.md](SPEC.md).

## 무엇인가

JLPT N5~N1 어휘 9,543개를 자동으로 넘기는 **오프라인 단일 페이지 앱**. 한국인 학습자 한 명을 위해 만들었다.

대상 사용자 프로필이 설계의 근거다 — 이걸 모르면 잘못된 판단을 한다:

- 한국어 모어. **히라가나·가타카나는 읽는다. 한자는 전혀 못 읽는다.**
- 그래서 한자만 큰 글씨로 보여주면 정보량이 0이다. 모든 카드에 かな 읽기와 한글 발음이 반드시 함께 나온다. 예문도 かな 읽기 줄이 없으면 못 읽는다.
- 핵심 후크는 **한국 한자음**이다. `問題=문제`, `雑談=잡담`처럼 한자음이 한국어 단어와 그대로 겹치는 항목이 4,317개(45%)다. 이 카드에는 `한자음 = 한국어` 배지가 붙고, 사용자는 외울 게 없다.
- 주 사용 패턴: 보조 모니터에 전체화면으로 몇 시간 방치. 그래서 무한 반복·유휴 시 UI 페이드·화면 절전 방지가 기능이 아니라 요구사항이다.

## 절대 규칙

깨면 앱이 사용자 환경에서 죽는다.

1. **`file://` 로 `index.html` 을 더블클릭해서 동작해야 한다.** `fetch`·`XHR`·ES 모듈·동적 `import` 금지. 데이터는 `<script src>` 로만 로드한다.
2. **네트워크 요청 0.** CDN 금지, 폰트도 로컬(`assets/fonts/`). 완전 오프라인.
3. **빌드 도구 없음.** 번들러·트랜스파일러 없이 브라우저가 바로 읽는 vanilla JS/CSS. `assets/app.js` 는 ES5 스타일(`var`, 함수 선언)로 일관되게 유지한다.
4. **데이터 파일은 부분적으로만 있어도 동작해야 한다.** `data/words-n3.js` 가 없어도 앱이 뜨고, 급수 목록은 로드된 데이터에서 런타임에 뽑는다. 선택 필드(`hj`·`hjp`·`e`·`ek`·`eh`·`eo`·`en`·`same`·`hL`·`ehL`·`kAlt`·`wAlt`)는 없을 수 있다.
5. **UI 텍스트는 한국어.**
6. **기본 동작을 바꾸지 않는다.** 사용자가 명시적으로 요구했다: 새 기능은 옵션으로 넣고 기본값은 지금까지의 동작(전체 재생 9,543 셔플, 15초, 채점 UI 숨김)을 유지한다.

## 구조

```
index.html            앱 셸 + 설정 패널 + 도움말. 에셋 참조에 ?v=N 캐시 무효화
assets/app.js         전부. IIFE 하나, 외부 의존 0
assets/style.css      토큰 + 레이아웃. 다크 기본, 라이트 지원
assets/fonts/*.woff2  서브셋된 폰트 5종 (원본은 original/, gitignore)
data/words-n{1..5}.js window.JLPT.push(...) 하는 생성물. 직접 손으로 고치지 말 것
tools/                데이터 파이프라인 (아래)
start.command         더블클릭용 로컬 http 서버 (file:// 제약 우회 경로)
```

## 데이터 파이프라인

```
jlpt-vocab-api(어휘) + KANJIDIC2(한자음)
        │  tools/build-base.js          SCRATCH 필요
        ▼
   base.json ◀── tools/add-words.js ◀── gap-words.json 302개 · rk-words.json 912개
        │                                   (rk 쪽은 tools/fetch-realkana.js 가 만든다)
        ├─ 청크 TSV 72개 ─▶ 번역 에이전트 ─▶ out/v2-*.jsonl
        │                    (.claude/agents/jlpt-translator.md)
        │  tools/merge.js
        ▼
   data/words-n*.js
        │  tools/build-kanji.js  (KANJIDIC2 + 이 단어들에서 예시 추출)
        ▼
   kanji-base.json ─ kchunks 9개 ─▶ 한자 에이전트 ─▶ kout/*.jsonl
        │                            (.claude/agents/jlpt-kanji.md)
        │  tools/merge-kanji.js
        ▼
   data/kanji.js
```

한자 파이프라인이 단어 파이프라인 **뒤**에 온다 — 예시 단어를 `data/words-n*.js` 에서 뽑기 때문이다. 단어를 추가했으면 한자도 다시 만들어야 예시가 갱신된다.

| 스크립트 | 역할 |
|---|---|
| `tools/build-base.js` | 원천 데이터 병합, 한자음 부착, 청크 TSV 생성. `SCRATCH` 에 원천 파일이 있어야 한다 |
| `tools/add-words.js` | `GAP=<파일> PREFIX=<접두사>` 로 목록을 base.json 에 덧붙이고 청크 생성. 기존 id 는 건드리지 않는다 |
| `tools/fetch-realkana.js` | realkana.com JLPT 덱을 RSC 페이로드로 받아 우리에게 없는 것만 `rk-words.json` 으로. `JMDICT=` 필요 |
| `tools/kana2hangul.js` | かな → 한글. `{long:true}` 면 장음 표기(도쿄→도-쿄-). 단독 실행하면 자체 테스트 출력 |
| `tools/example-hangul.js` | 예문 한글 발음. 한자 표기와 かな 읽기를 정렬해 어절 단위로 끊는다. 단독 실행 시 테스트 |
| `tools/merge.js` | JSONL 병합 → `data/words-n*.js` + 품질 리포트. 정합성 검사와 중복 제거가 여기 있다 |
| `tools/build-kanji.js` | 한자 2,142자: KANJIDIC2 읽기·획수·한자음 + 단어 덱에서 예시 단어 3개 → `kanji-base.json` + kchunks |
| `tools/merge-kanji.js` | 한자 JSONL 병합 → `data/kanji.js`. 훈음 음절이 한자음과 어긋나면 버린다 |
| `tools/kanji-list.txt` | 덱에 등장하는 고유 한자 2,118자(2,142 로 갱신 필요), 급수별·빈도순. 외부 사이트에 붙여넣을 때 쓴다 |
| `tools/kanji-ko-fix.js` | KANJIDIC2 에 `korean_h` 가 없는 한자 보정표 + 두음법칙(령수→영수) |
| `tools/next-chunks.js` | 아직 번역 안 된 청크 이름 출력 |
| `tools/wave.sh` | 유휴 에이전트 pane 회수 + 다음 청크 N개 출력 |
| `tools/font-charset.js` | 데이터·UI에 실제 등장하는 글자만 폰트별로 추출 → `tools/charset/*.txt` |
| `tools/subset-fonts.sh` | 그 문자집합으로 폰트 서브셋 (원본은 `assets/fonts/original/` 로 보관) |

### 재생성

```bash
# 데이터만 다시 만들기 (번역 결과가 SCRATCH/build/out/*.jsonl 에 있을 때)
SCRATCH=<작업디렉터리> node tools/merge.js

# 폰트 서브셋 (데이터에 새 한자가 생겼을 때 필수)
node tools/font-charset.js && ./tools/subset-fonts.sh
```

`SCRATCH` 없이 `node tools/merge.js` 를 돌리면 `tools/cache/base.json` 만 읽고 **아무 파일도 쓰지 않는다**(단어 0개 → 기록 생략). 조용히 성공하니 착각하지 말 것.

### 단어 추가

`tools/gap-words.json` 형식(`{w, k, lv, en}`)으로 목록을 넣고:

```bash
SCRATCH=<작업디렉터리> CHUNK=101 node tools/add-words.js   # base.json 갱신 + gap-pNN 청크
# 청크마다 jlpt-translator 에이전트 1대 → out/v2-gap-pNN.jsonl
SCRATCH=<작업디렉터리> node tools/merge.js
node tools/font-charset.js && ./tools/subset-fonts.sh      # 새 한자가 들어오므로 거의 항상 필요
```

`add-words.js` 는 기존 id 를 건드리지 않고 뒤에 붙이며, `SCRATCH/build/base.json` 과 `tools/cache/base.json` 을 함께 쓴다. `kanjidic2.xml` 이 `SCRATCH` 에 있어야 한자음이 붙는다 — 없으면 배지를 전부 잃는다.
청크는 급수가 섞여 있으므로 에이전트 프롬프트에 그 사실을 알려야 한다(예문 난이도를 파일 단위가 아니라 단어별로 판단하게).
끝나면 README·AGENTS 의 수록량·배지 수치와 `index.html` 의 `?v=N` 을 같이 올린다.

## 불변조건과 검증

데이터를 건드렸으면 이걸 돌린다. 전부 통과해야 한다.

```bash
node -e '
global.window={JLPT:[]};for(const l of [5,4,3,2,1])require("./data/words-n"+l+".js");
const W=window.JLPT, KANA=/^[ぁ-んァ-ヴーゝゞ・]+$/, K=/[一-鿿]/;
const bad=(n,v)=>console.log((v?"FAIL":"ok  ")+" "+n+(v?" = "+v:""));
bad("완전중복",       W.length-new Set(W.map(x=>x.w+"|"+x.k)).size);
bad("id중복",        W.length-new Set(W.map(x=>x.i)).size);
bad("읽기 비かな",    W.filter(x=>!KANA.test(x.k)).length);
bad("표기에 괄호/슬래시", W.filter(x=>/[（）()\/=]/.test(x.w)).length);
bad("뜻 없음",       W.filter(x=>!x.ko||!x.ko.length).length);
bad("예문 결손",      W.filter(x=>!x.e||!x.ek||!x.eo).length);
bad("ek에 한자",      W.filter(x=>x.ek&&K.test(x.ek)).length);
bad("예문에 숫자",     W.filter(x=>x.e&&/[0-9０-９]/.test(x.e)).length);
const mis=W.filter(x=>{const s=x.w.slice(0,2),s1=x.w.slice(0,1);
  return !((x.e&&(x.e.includes(s)||x.e.includes(s1)))||(x.ek&&x.ek.includes(x.k.slice(0,2))))});
bad("예문-단어 불일치", mis.length);
bad("한자음에 ?",     W.filter(x=>(x.hjp&&x.hjp.includes("?"))||(x.hj&&x.hj.includes("?"))).length);
const noHj=W.filter(x=>K.test(x.w)&&!x.hj).map(x=>x.w);
console.log((noHj.join("")==="雫枠枠内"?"ok   ":"FAIL ")+"한자음 없는 한자어 = "+(noHj.join(" ")||"없음"));
console.log("총",W.length,"| 배지",W.filter(x=>x.same).length);'
```

기준값: 총 9,543 / 배지 4,317 / **예문-단어 불일치 1** / **한자음 없는 한자어 = 雫 枠 枠内** / 나머지 전부 0.

한자 데이터는 이걸 추가로 돌린다 — 기준값 한자 2,142 / 훈음 2,139 / 한자음 2,140, 나머지 0:

```bash
node -e '
global.window={JLPT:[],JLPT_KANJI:[]};for(const l of [5,4,3,2,1])require("./data/words-n"+l+".js");
require("./data/kanji.js");
const W=window.JLPT, KJ=window.JLPT_KANJI;
const chk=(n,v)=>console.log((v?"FAIL":"ok  ")+" "+n+(v?" = "+v:""));
chk("한자 중복", KJ.length-new Set(KJ.map(x=>x.c)).size);
chk("한자 뜻없음", KJ.filter(x=>!x.ko||!x.ko.length).length);
chk("한자 예시없음", KJ.filter(x=>!x.ex||!x.ex.length).length);
chk("훈음 음절 불일치", KJ.filter(x=>x.hun&&x.hj&&x.hun.split(/\s+/).pop()!==x.hj).length);
const wu=new Set(W.map(x=>x.lv+"-"+x.i));
chk("uid 충돌", KJ.filter(x=>wu.has(x.lv+"-"+x.i)).length);
console.log("한자",KJ.length,"훈음",KJ.filter(x=>x.hun).length,"한자음",KJ.filter(x=>x.hj).length);'
```

`uid 충돌` 이 0 이어야 한다. 한자 카드의 `i` 는 `k1867` 처럼 접두사가 붙어 있어서 단어 uid(`5-12`)와 겹치지 않는다 — 겹치면 즐겨찾기·채점·본 횟수가 단어와 섞인다.

그 1건은 `居る(おる)` 로, 예문이 かな 활용형(`部屋におります`)을 쓰는 정상 카드다 — 검사식이 `おる` 를 찾는데 문장에는 `おり` 만 있다. 0을 만들려고 검사식을 느슨하게 하지 말 것.

### 틀린 읽기 잡는 검사 (원천 데이터 오류 탐지용)

카드의 `k` 가 자기 `ek` 안에 없으면 읽기가 틀렸을 가능성이 높다. 예문은 옳은 읽기로 쓰여 있어서 대조가 된다.
이 검사로 원천 데이터의 오류 15건(真実=さな, 昼間=ちゅうかん …)을 찾아냈다.

```bash
node -e '
global.window={JLPT:[]};for(const l of [5,4,3,2,1])require("./data/words-n"+l+".js");
const W=window.JLPT;
const sus=W.filter(x=>x.ek&&x.k.length>=3&&!x.ek.includes(x.k.slice(0,3))&&!x.ek.includes(x.k.slice(0,2)));
console.log(sus.length, sus.map(x=>x.w+"("+x.k+")").join(" "));'
```

**기준값 6건** — 전부 정상이며, 목록에 없던 단어가 새로 뜨면 그게 의심 대상이다:

| 단어 | 왜 정상인가 |
|---|---|
| 九(きゅう) · 十(じゅう) | 복수 읽기 단어. 예문이 `kAlt` 쪽(く·とお)을 쓴다 |
| そうして · やはり | 복수 표기 단어. 예문이 `wAlt` 쪽(そして·やっぱり)을 쓴다 |
| 不足(ふそく) | 복합어에서 연탁 — 運動不足 = うんどう**ぶ**そく |
| 化する(かする) | 활용형 — 예문은 化した |

활용을 감안해 검사식을 느슨하게 만들지 말 것. 2모라 동사(引く→ひきます)가 전부 걸려 181건이 오탐으로 뜬다 — 실제로 시도해 봤다.
`雫`·`枠` 만 한자음이 비어 있는 게 정상이다 — 일본에서 만든 국자(国字)라 한국 한자음이 존재하지 않는다. 목록이 늘어나면 `tools/kanji-ko-fix.js` 에 추가할 대상이다.

폰트를 다시 서브셋했으면 글자 손실도 확인한다 (누락 목록이 `assets/fonts/original/` 의 원본과 같아야 하고, 서브셋 때문에 늘어나면 안 된다):

```bash
uv run --quiet --with "fonttools[woff]" python - <<'PY'
from fontTools.ttLib import TTFont; import pathlib
CS=pathlib.Path("tools/charset")
for name,cs in {"klee-one-japanese-400-normal":"word","noto-sans-jp-japanese-400-normal":"jp","noto-sans-kr-korean-400-normal":"kr"}.items():
    for base in ("assets/fonts","assets/fonts/original"):
        p=pathlib.Path(base)/f"{name}.woff2"
        if not p.exists(): continue
        f=TTFont(p); have=set()
        for t in f["cmap"].tables: have|=set(t.cmap.keys())
        need={ord(c) for c in (CS/f"{cs}.txt").read_text(encoding="utf-8")}
        print(f"{base:26s} {name:34s} 누락={len(need-have)}")
PY
```

## 이미 밟은 함정

같은 데 다시 빠지지 말 것. 전부 실제로 발생했다.

- **번역 에이전트가 id를 1부터 새로 매긴다.** 뜻이 엉뚱한 단어에 붙어 데이터 전체가 조용히 오염된다(`問題` → "빵"). `tools/merge.js` 의 `alignment()` 가 파일 단위로 정합률 50% 미만이면 통째로 버린다. 이 가드를 제거하지 말 것.
- **청크는 140행을 넘기지 않는다.** `build-base.js` 의 기본값이 그래서 140이다 (한때 280이었고, AGENTS.md 가 금지한 바로 그 값이었다). 280행짜리는 에이전트 출력이 `64000 output token maximum` 에 걸려 결과가 사라진다.
- **에이전트 동시 실행은 8대가 상한**(tmux pane 풀). 초과하면 `fork failed: Device not configured`. `tools/wave.sh` 로 유휴 pane 회수 후 다음 웨이브를 띄운다.
- **번역 에이전트는 반드시 낮은 추론 강도로.** 세션 설정을 물려받으면 `xhigh` 로 돌아 5배 느려진다. `.claude/agents/jlpt-translator.md` 의 `effort: low` 가 그 용도다.
- **조사 분리는 원문 かな 안에서만.** 한자 읽기 구간에서 하면 `ながい` 의 `が` 를 조사로 착각해 `나가 / 이데스` 로 쪼갠다. `tools/example-hangul.js` 의 `refine()` 참고.
- **1음절 한자음은 부분일치 금지.** `磨く` 의 한자음 `마` 가 `연마하다` 안에 걸려 배지가 잘못 붙었다. 지금은 접두 일치만 인정한다(`黒` 흑 → `흑색` 은 유지).
- **원천 데이터에 복수 읽기·주석이 섞여 있다.** `九[きゅう / く]`, `ね[（感）]`. `merge.js` 가 대표 형태만 남기고 나머지는 `kAlt`·`wAlt` 로 분리한다. 정규화하면 중복이 새로 생기므로(42건) 그 뒤에 한 번 더 제거한다. 이때 **낮은 급수(N5)를 남긴다** — 정렬이 `b.lv - a.lv` 인 이유다. 한때 반대로 정렬해 日付·昼間·途中 이 N1 으로 잘못 분류돼 있었다.
- **KANJIDIC2 에 `korean_h` 가 없는 한자가 있다.** 신자체가 주로 그렇다(`収` — 구자체 `收` 에만 음이 달려 있음). 그러면 카드에 `収?` 가 뜨고 그 단어는 `hj` 전체를 잃어 배지까지 빠진다. `tools/kanji-ko-fix.js` 에 보정하고, `merge.js` 가 그걸로 `hjp`·`hj` 를 다시 세운다. 한자가 전부 미등록이면 base 가 `hjp` 를 `null` 로 주므로 표기에서 한자를 직접 뽑아 세우는 경로도 있다.
- **두음법칙을 적용해야 배지가 붙는다.** KANJIDIC2 는 글자 음(領=령, 旅=려, 練=련)을 주는데 한국어 단어는 어두에서 바뀐다(영수·여행·연습). 적용 전 3,710 → 적용 후 3,858 로 147개가 살아났다. 단어 단위 `hj` 에만 적용하고, 글자별 `hjp` 는 사전형(령)으로 둔다.
- **"JLPT 목록은 전부 tanos 파생"이라고 단정하지 말 것 — 한 번 그렇게 답했고 틀렸다.** GitHub 에 올라온 목록(jamsinclair·elzup·Bluskyo·jisho·JLPT Sensei)은 실제로 다 tanos 뿌리지만, 그게 전부는 아니다. realkana.com 의 JLPT 덱은 5,415개로 선별이 다르고 우리에게 없는 단어가 950개였다(`tools/fetch-realkana.js`). GitHub 검색만으로 "더 없다"고 결론내지 말고 학습 사이트의 실제 덱을 확인할 것.
- **"내보내기 버튼이 없다"와 "데이터를 못 얻는다"는 다른 말이다.** realkana 는 붙여넣기·내보내기 UI 가 없어서 한때 불가능하다고 답했는데, Next.js RSC 페이로드(`RSC: 1` 헤더)에 덱 전체가 실려 와서 **요청 한 번**으로 5,415장을 다 받았다. 플래시카드를 넘겨 긁을 필요도 없었다. UI 에 기능이 없으면 네트워크 계층을 먼저 볼 것.
- **원천이 흘린 행을 되찾는 것도 실익이다**: tanos 의 `足; 脚` 이형태, `～回` 접사, `(かん)` 품사 주석, `パート (タイム)` 분할 표기를 처리하다 302개가 사라져 있었고 거기에 顔·父·母 같은 N5 핵심어가 있었다. 목록은 `tools/gap-words.json`, 대조 상대는 [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab)(같은 tanos 를 JMdict 로 정규화한 판)과의 **합집합**이다 — 이쪽도 顔·父·母 가 빠져 있어서 한쪽만 믿으면 안 된다.
- **원천 어휘 목록에 틀린 읽기가 섞여 있다.** `真実`=さな(존재하지 않는 낱말), `昼間`=ちゅうかん(中間의 읽기), `梯子`=ていし, `他人`=あだびと … 15건을 `tools/kanji-ko-fix.js` 의 `READING_FIX` 로 교정했다. **찾는 방법: 카드의 `k` 가 자기 `ek` 안에 없으면 의심하라** — 예문은 옳은 읽기로 쓰여 있어서 대조가 가능하다. 사용자는 한자를 못 읽으니 이 필드가 틀리면 かな·한글·TTS 가 한꺼번에 틀린 발음을 가르친다.
- **외래어가 히라가나로 풀려 오는 예문이 있었다.** 「ボールをうまくキャッチした」의 `ek` 가 「ぼーるをうまくきゃっちした」. `restoreKatakana()` 가 `e` 의 가타카나를 `ek` 에 복원한다.
- **は·へ 조사는 わ·え 로 읽는다.** 예문 한글 발음에서 이걸 놓치면 28%의 카드가 틀린 발음을 가르친다(몬다이하 → 몬다이와). 조사 판정은 근거 있는 자리에서만 한다 — 한자 읽기 직후, 가타카나·구두점 앞뒤, 표제어 직후. 히라가나 사이에 낀 は 는 단어 내부의 は(はな·はず)와 구별할 수 없어 보수적으로 남겨 둔다.
- **かな 읽기 정렬은 한쪽에서 욕심내면 반드시 틀린다.** 왼쪽부터면 「母は元気です」(ははは…)에서 母를 「は」로 읽고, 오른쪽부터면 「彼の料理の…」의 첫 の를 두 번째 の로 잡는다. `align()` 은 후보를 전부 시도해 「한자 하나당 2모라」에 가깝고 표제어 읽기와 맞는 배치를 고른다.
- **어절 경계는 발음을 바꾼다.** 표기법상 か·た행은 어두에서 평음, 어중에서 격음이라 잘못 끊으면 `とても`가 `토 데모`가 된다. 그래서 근거 없는 위치에서는 끊지 않는다(で·と·か·や 는 조사 분리 대상에서 제외 — です/とても 를 쪼갠다).
- **헤드리스 TTS 검증은 발화 객체까지 가짜로 만들어야 한다.** `speechSynthesis` 만 바꿔치기하면 `utter()` 가 조용히 죽는다 — 가짜 음성 객체를 진짜 `SpeechSynthesisUtterance.voice` 에 대입하면 TypeError 고, 그게 `speak()` 의 `try` 에 먹힌다. `window.SpeechSynthesisUtterance` 도 같이 갈아끼울 것. 그리고 **드라이버 첫 줄에서 `localStorage.clear()`** — 헤드리스가 프로필을 재사용해서 앞 실행에서 켠 음소거가 남아 다음 실행이 전부 무음으로 나온다(실제로 한 번 헤맸다).
- **`file://` 은 CSS/JS를 캐시한다.** 수정했는데 반영이 안 되면 `index.html` 의 `?v=N` 을 올린다. 안 올리면 사용자가 "안 바뀌었다"고 한다 — 실제로 두 번 겪었다.
- **`.hjp i b` 는 Klee One(`--f-word`), `.hjp i span` 은 KR 폰트.** 폰트 서브셋이 이 경계를 전제로 글자를 나눠 담는다. 셀렉터를 바꾸면 서브셋도 다시 만들어야 한다. 한자 카드가 이 줄에 음독·훈독 かな 를 넣기 때문에 `tools/font-charset.js` 는 그 かな 를 `jp` 뿐 아니라 **`word` 집합에도** 넣는다 — 안 넣으면 Klee 가 못 그려서 폰트 폴백이 뜬다.
- **CSS 안에만 있는 글자도 서브셋 대상이다.** 한자 카드의 음·훈 라벨은 `content:"음"` / `content:"훈"` 이라 마크업·JS 에 없다. `font-charset.js` 가 `style.css` 까지 읽는 이유다.
- **한자 카드는 발음을 한 글자로 읽히지 않는다.** `日` 을 그냥 넘기면 음성이 ニチ/ひ 중 뭘 읽을지 알 수 없다. 대표 예시 단어의 かな 를 읽는다.
- **Noto Sans JP 700 은 일부러 없다.** 굵은 일본어를 쓰는 자리가 `.mark b` 하나인데 내용이 한국어라 한 글자도 안 그렸다. 되살리지 말 것.

## UI 검증 방법

브라우저 없이는 확인이 안 되므로 헤드리스 Chrome 을 쓴다. 스크린샷:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --window-size=1500,950 --screenshot=/tmp/shot.png --virtual-time-budget=5000 \
  --enable-logging=stderr --log-level=0 "file://$PWD/index.html" 2>&1 | grep -iE "SEVERE|Uncaught|TypeError"
```

클릭·키 입력이 필요한 검증은 임시 드라이버를 주입한다(둘 다 gitignore 돼 있다):

```bash
# _driver.js 에 검증 로직을 쓰고 결과를 document.title 에 넣는다
node -e 'const fs=require("fs");let h=fs.readFileSync("index.html","utf8");
  h=h.replace("</body>","<script src=\"_driver.js\"><\/script>\n</body>");fs.writeFileSync("_test.html",h)'
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=12000 --dump-dom "file://$PWD/_test.html" 2>/dev/null | rg -o "RESULT[^<]*"
rm -f _test.html _driver.js
```

기본 동작을 바꾸지 않았는지 항상 함께 확인한다: 전체 재생 모드에서 `1 / 8631`, 채점 버튼 `hidden`, 저장된 `set` 이 `words`.

TTS 를 검증할 때는 발화 객체까지 가짜로 만들고(아래 함정 참고) `onend` 를 타이머로 흘려 줘야 발화 사슬(단어 → 쉼 → 예문)이 진행된다.

## 상태 저장

localStorage 키 — 스키마를 바꾸려면 키 이름의 버전을 올린다.

| 키 | 내용 |
|---|---|
| `jlpt.settings.v1` | 설정 전체 (`DEFAULTS` 참고) |
| `jlpt.fav.v1` | 즐겨찾기, `lv-i` 로 키잉 |
| `jlpt.views.v1` | 본 횟수 |
| `jlpt.pos.v1` | 마지막 위치 |
| `jlpt.srs.v1` | 간격 반복 상자 `{b, d, n}` |
| `jlpt.batch.v1` | 현재 배치의 uid 목록 |

`file://` 과 GitHub Pages 는 origin 이 달라 **저장소가 분리된다.** 한쪽에서 채점한 게 다른 쪽에 안 보이는 건 버그가 아니다.

## 라이선스 (중요)

혼합이다. 자세한 건 [ATTRIBUTION.md](ATTRIBUTION.md).

- 코드는 MIT(`LICENSE`), **데이터는 CC BY-SA 4.0**(`data/LICENSE`). 한자음이 KANJIDIC2 파생이라 ShareAlike 가 전염된다. **데이터에 허용적 라이선스를 붙이지 말 것.**
- 어휘 목록 원본(tanos.co.uk 유래)은 명시적 라이선스가 없다. 공개 재배포 근거가 불확실하다는 사실을 지우거나 흐리지 말 것.
- 폰트는 SIL OFL 1.1. `assets/fonts/LICENSE-*.txt` 를 반드시 함께 배포한다.

## 배포

`main` 에 push 하면 GitHub Pages 가 https://alfex4936.github.io/JLPT/ 로 배포한다(`.nojekyll` 필요). 상태 확인:

```bash
GH_HOST=github.com gh api repos/Alfex4936/JLPT/pages --jq '.status'
```

`gh` 는 회사 호스트(git.linecorp.com)와 github.com 을 함께 물고 있다. 저장소 밖에서 `gh` 를 쓸 때만 `GH_HOST=github.com` 을 붙인다. 이 저장소의 커밋 identity 는 repo-local 로 `Alfex4936@users.noreply.github.com` 이다 — 전역(회사 이메일)으로 되돌리지 말 것.

## 코드 스타일

- 주석은 1줄, 최대 2줄. 코드를 다시 설명하는 주석은 쓰지 않는다. 비자명한 이유·함정·불변조건만 남긴다.
- 커밋 메시지는 영어 산문, `feat:`/`fix:`/`perf:`/`chore:` 접두. 무엇을 왜 바꿨고 어떻게 검증했는지 쓴다.
- 문서·UI·주석은 한국어. 식별자·명령·에러 문자열은 원문 그대로.
