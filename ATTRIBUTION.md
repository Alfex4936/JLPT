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

## 7. かな·기사 제목 음성 — Gemini TTS 로 생성

`assets/audio/*.opus` (かな 131음) 와 `assets/audio/read/*.opus` (기사 제목 46개) 는
Google Gemini TTS(`gemini-3.1-flash-tts-preview`, 음성 `Zephyr`)로 생성했다. `tools/build-kana-audio.js`
와 `tools/build-reading-audio.js` 가 만든다.

- Gemini API 약관의 **Use of Generated Content**: "Google won't claim ownership over that content. ...
  You're responsible for your use of generated content, and for the use of that content by anyone you share it with."
  즉 구글이 소유권을 주장하지 않고, 공유를 전제로 쓰인 조항이다.
- **CC 표기를 붙이지 말 것.** 구글이 CC 라이선스를 준 게 아니다. 3번 항목(Claude 생성물)과 같이 출처만 밝힌다.
- 재생성할 때는 **유료 할당량**으로 돌릴 것. 무료 할당량은 사람이 입출력을 검토하고 학습에 쓴다(약관 Unpaid Services).
- 기기 TTS 를 대체하는 게 아니라 앞에 둔다. 음원이 없으면 `speechSynthesis` 로 떨어진다.
  기사 **본문**은 음원이 없다 — 문장 350개를 실으면 8~12MB 라 기기 TTS 를 그대로 쓴다.

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
