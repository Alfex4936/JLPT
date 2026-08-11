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

## 5. 폰트 — SIL Open Font License 1.1

`assets/fonts/` 에 woff2 파일을 함께 담고 있다. OFL 은 재배포를 허용하되 라이선스 사본 포함을 요구한다.

| 폰트 | 저작권 | 라이선스 파일 |
|---|---|---|
| Klee One | The Klee Project Authors (Fontworks) | `assets/fonts/LICENSE-klee-one.txt` |
| Noto Sans JP | Google Inc. | `assets/fonts/LICENSE-noto-sans-jp.txt` |
| Noto Sans KR | Google Inc. | `assets/fonts/LICENSE-noto-sans-kr.txt` |

## 정리 — 권장 라이선스 구성

| 대상 | 라이선스 |
|---|---|
| 코드 (`index.html`, `assets/app.js`, `assets/style.css`, `tools/*`) | 자유 선택 (MIT 등) |
| 데이터 (`data/words-n*.js`, `tools/cache/base.json`) | **CC BY-SA 4.0** — KANJIDIC2 파생이라 강제됨 |
| 폰트 (`assets/fonts/*`) | SIL OFL 1.1 (사본 포함, 위 표) |
