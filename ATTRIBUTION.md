# 출처와 라이선스

이 저장소는 서로 다른 라이선스의 자료를 함께 담고 있다. 공개 배포 전에 이 문서를 확인할 것.

## 1. 한국 한자음 — KANJIDIC2 (CC BY-SA 4.0) ⚠️ 전염성 있음

`data/words-n*.js` 의 `hj`·`hjp` 필드는 [KANJIDIC2](http://www.edrdg.org/wiki/index.php/KANJIDIC_Project) 의
`korean_h` 리딩에서 파생됐다.

- 저작권: Electronic Dictionary Research and Development Group (EDRDG), Monash University
- 라이선스: **Creative Commons Attribution-ShareAlike 4.0 International**
- 요구사항: **출처 표시(Attribution)** + **동일조건 변경허락(ShareAlike)**

ShareAlike 이므로 이 필드를 포함한 데이터를 재배포할 때는 **같은 CC BY-SA 4.0 으로 공개**해야 한다.
데이터 파일에 MIT 같은 허용적 라이선스를 붙일 수는 없다.

## 2. 어휘 목록 — tanos.co.uk 유래 (명시적 라이선스 없음) ⚠️

표기·かな·급수·영어 뜻은 [jlpt-vocab-api](https://github.com/wkei/jlpt-vocab-api) 에서 왔고,
그 저장소는 데이터 출처를 [tanos.co.uk](http://www.tanos.co.uk/jlpt/) (Jonathan Waller) 의 JLPT 어휘 목록으로 밝히고 있다.

**jlpt-vocab-api 에는 LICENSE 파일이 없다.** 원 목록의 배포 조건도 명문화돼 있지 않다.
개인 학습용으로 널리 쓰이는 자료이지만, 공개 재배포의 법적 근거가 확실하지 않다는 뜻이다.
공개 저장소로 올릴 경우 감수해야 하는 리스크이고, 문제가 되면 원저자 요청에 따라 내리는 것이 맞다.
급수 배정 역시 JLPT 공식 기준이 아니다(공식 어휘 목록은 2010년에 발행 중단).

## 3. 한국어 뜻·품사·예문 — 이 저장소에서 생성

`ko`·`p`·`e`·`ek`·`eo` 필드는 Claude(Anthropic) 로 생성했다. 사람이 전수 검수하지 않았다.
기계적 검증만 통과한 상태다: 예문–단어 정합률 100%, かな 읽기에 한자 0건, 중복 0건.
자연스러움·정확성은 표본 검수만 했다.

## 4. 한글 발음 표기 — 이 저장소에서 생성

`h`·`hL`·`eh`·`ehL` 은 `tools/kana2hangul.js` 와 `tools/example-hangul.js` 가 계산한다.
국립국어원 일본어 한글 표기법을 근거로 구현했다.

## 5. かな 로마자 표기 — 이 저장소에서 생성

`data/kana.js` 의 `r`(대표 romaji)·인정 입력 목록은 헵번식을 기준으로 손으로 적었고,
`h`(한글 표기)는 위 4번과 같은 `tools/kana2hangul.js` 가 계산한다. 표 배치(열 구성)는
[realkana.com](https://realkana.com) 의 오십음도·확장표 구성을 참고했다 — 배치는 오십음도 그 자체이고
저작물성이 있는 자료를 옮겨오지는 않았다.

## 6. 읽기 기사 — ウィキニュース (CC BY 4.0)

`data/reading.js` 의 기사 본문은 [ウィキニュース 日本語판](https://ja.wikinews.org) 에서 가져왔다.

- 라이선스: **Creative Commons Attribution 4.0** (API 의 `rightsinfo` 로 확인). ShareAlike 가 아니라 출처 표시만 요구한다.
- 기사마다 `u` 에 원문 주소가 있고, 앱이 카드 하단에 원문 링크·날짜·라이선스를 표시한다. 이 표시를 지우지 말 것 — CC BY 의 요구사항이다.
- 후리가나(`r`)와 문장 かな 읽기(`k`)는 이 저장소에서 만든 파생물이고, 한국어 번역(`o`)도 이 저장소 생성물이다. 사람이 전수 검수하지 않았다.
- **본문을 고친 곳이 있다.** CC BY 는 ND 가 아니라 수정을 허용하지만 §3(a)(1)(B) 가 "변경했다는 표시"를 요구한다 —
  그 표시가 이 항목이다. 고치는 이유는 하나뿐이다: 음성이 원문과 다르게 읽은 자리를 음성에 맞춘다.
  화면 글자와 들리는 소리가 어긋나면 학습자가 틀린 것을 배운다. 지금까지 고친 것:
  - `r39239` 2번 문장 어미 `とされている` → `とされています` (음성이 정중체로 읽었다)
- `data/reading.js` 는 `tools/merge-reading.js` 가 만드는 생성 파일이다. 위 손수정은 다시 빌드하면 사라진다 —
  덱을 다시 만들면 이 목록을 보고 되먹여야 한다.

## 7. かな·기사·단어 음성 — Gemini TTS 로 생성

`assets/audio/*.opus` (かな 131음), `assets/audio/read/*.opus` (기사 제목·문장), `assets/audio/word/*.opus` (단어 읽기) 는
Google Gemini TTS(`gemini-3.1-flash-tts-preview`, 음성 `Zephyr`)로 생성했다. `tools/build-kana-audio.js`
와 `tools/build-reading-audio.js`, `tools/build-word-audio.js` 가 만든다.

- Gemini API 약관의 **Use of Generated Content**: "Google won't claim ownership over that content. ...
  You're responsible for your use of generated content, and for the use of that content by anyone you share it with."
  즉 구글이 소유권을 주장하지 않고, 공유를 전제로 쓰인 조항이다.
- **CC 표기를 붙이지 말 것.** 구글이 CC 라이선스를 준 게 아니다. 3번 항목(Claude 생성물)과 같이 출처만 밝힌다.
- **지금 실린 かな 음원은 무료 등급(Unpaid Services)에서 생성됐다.** 재배포는 문제없지만(Use of Generated Content),
  무료 등급은 구글이 입출력을 제품 개선에 쓰고 사람이 검토할 수 있다. 앞으로 다시 만들 때는 결제를 붙여 유료
  할당량으로 돌리는 게 맞다 — 무료 등급은 요청 한도가 10이라(`generate_content_free_tier_requests`)
  기사 음원은 한 편도 끝내지 못한다.
- 기기 TTS 를 대체하는 게 아니라 앞에 둔다. 음원이 없으면 `speechSynthesis` 로 떨어진다.
- 기사 음원은 `data/audio.js` 에 등재된 기사만 쓴다. **기사 하나가 단위다** — 제목과 모든 문장을 다 만들거나
  아예 안 만든다. 반쪽 기사를 쓰면 한 기사 안에서 줄마다 화자가 바뀐다.
- 파일은 요청 시점에만 받는다(`new Audio()`). 수십 MB 가 되지만 첫 화면 로딩에는 영향이 없다.
- 단어 음원은 파일명이 읽기(かな) 그 자체라 매니페스트가 없다. 한자 모드도 이걸 쓴다 —
  한자는 읽기를 정할 수 없어(日 = ニチ? ひ?) 대표 단어를 읽고, 그 읽기가 단어 덱 읽기에 100% 포함된다.
- 단어 **예문 문장**은 만들지 않았다. 9,437문장이면 85MB 인데 `예문도 읽기` 는 기본값이 꺼져 있다 —
  git 히스토리는 지워지지 않으므로 균형이 맞지 않는다. 예문은 기기 TTS 로 읽는다.

## 8. 폰트 — SIL OFL 1.1 + Apache-2.0

`assets/fonts/` 에 woff2 파일을 함께 담고 있다. 두 라이선스 모두 재배포를 허용하되 라이선스 사본 포함을 요구한다.
かな 글꼴 6종은 かな 만 남기고 서브셋했다(각 18~36KB).

| 폰트 | 쓰임 | 저작권 | 라이선스 | 파일 |
|---|---|---|---|---|
| Klee One | 표기(한자) | The Klee Project Authors (Fontworks) | OFL 1.1 | `assets/fonts/LICENSE-klee-one.txt` |
| Noto Sans JP | かな·예문 | Google Inc. | OFL 1.1 | `assets/fonts/LICENSE-noto-sans-jp.txt` |
| Noto Sans KR | 한국어 | Google Inc. | OFL 1.1 | `assets/fonts/LICENSE-noto-sans-kr.txt` |
| Kosugi Maru | かな 글꼴 | MOTOYA / Google Inc. | **Apache-2.0** | `assets/fonts/LICENSE-kosugi-maru.txt` |
| Shippori Mincho | かな 글꼴 | The Shippori Mincho Project Authors | OFL 1.1 | `assets/fonts/LICENSE-shippori-mincho.txt` |
| Zen Kurenaido | かな 글꼴 | The Zen Kurenaido Project Authors | OFL 1.1 | `assets/fonts/LICENSE-zen-kurenaido.txt` |
| Yusei Magic | かな 글꼴 | The Yusei Magic Project Authors | OFL 1.1 | `assets/fonts/LICENSE-yusei-magic.txt` |
| Hachi Maru Pop | かな 글꼴 | The Hachi Maru Pop Project Authors | OFL 1.1 | `assets/fonts/LICENSE-hachi-maru-pop.txt` |
| Dela Gothic One | かな 글꼴 | The Dela Gothic Project Authors | OFL 1.1 | `assets/fonts/LICENSE-dela-gothic-one.txt` |

Kosugi Maru 만 Apache-2.0 이다. OFL 로 뭉뚱그리지 말 것.

## 정리 — 권장 라이선스 구성

| 대상 | 라이선스 |
|---|---|
| 코드 (`index.html`, `assets/app.js`, `assets/style.css`, `tools/*`) | 자유 선택 (MIT 등) |
| 데이터 (`data/words-n*.js`, `data/kanji.js`, `tools/cache/*.json`) | **CC BY-SA 4.0** — KANJIDIC2 파생이라 강제됨 |
| `data/kana.js` | KANJIDIC2 파생이 아니다. 코드와 같은 라이선스로 둘 수 있다 |
| `data/reading.js` | ウィキニュース 파생 — **CC BY 4.0**, 출처 표시 필요 |
| 폰트 (`assets/fonts/*`) | SIL OFL 1.1, Kosugi Maru 는 Apache-2.0 (사본 포함, 위 표) |
| 음성 (`assets/audio/*`) | Gemini TTS 생성물. 구글이 소유권을 주장하지 않는다 — CC 표기는 붙이지 말 것 |
