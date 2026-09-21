#!/bin/bash
# 음원 생성을 끝까지 밀어붙이는 드라이버. 할당량에 막히면 쉬었다 이어서 만든다.
#
#   GEMINI_API_KEY=... bash tools/audio-drive.sh
#
# 왜 필요한가: Gemini 3.1 Flash TTS 는 RPD 100 · RPM 10 이다(Tier 1 에서 실측. 이 모델은
# 공개 한도표에 행이 없다 — 표에는 2.5 Pro/Flash TTS 만 있고, preview 는 더 조인다고만 적혀 있다). 남은 작업이
# 수백 요청이라 한 번에 끝나지 않는다. 두 생성기 모두 이미 있는 파일을 건너뛰므로
# 몇 번을 돌려도 안전하고, 매번 없는 것만 채운다.
#
# 일일 한도에 걸리면 생성기가 종료 코드 3 으로 끝난다. 재시도를 하지 않으므로 막힌 회차는
# 5요청이 아니라 1요청만 쓴다(실측: 재시도를 돌렸을 때 100요청 한도에서 클립 33개만 나왔다).
#
# 한도는 **롤링 24시간**이다. 문서는 "태평양 자정에 리셋" 이라고 하지만 실측이 다르다 —
# 어제 그 시각에 쓴 만큼이 오늘 그 시각에 풀린다:
#   09-15 17시 1요청 → 09-16 17시 2요청 · 18시 5 → 4 · 19시 0 → 0 · 20시 2 → 1 · 21시 0 → 0
# 안 쓴 시간에는 아무것도 안 풀린다. 그래서 **계속 켜 두는 게 맞다** — 슬롯이 풀리는 순간
# 돌고 있어야 줍는다. 껐다 켜면 그 사이에 풀린 몫을 놓친다.
# 응답의 retryDelay 는 23시간을 가리키지만 45분 뒤에 이미 슬롯이 생긴다. 믿지 말 것.
#
# 한도는 프로젝트 단위다(문서: "applied per project, not per API key"). 키를 바꿔 봐야
# 같은 프로젝트면 같은 100을 나눠 쓴다.
set -u
cd "$(dirname "$0")/.." || exit 1

: "${GEMINI_API_KEY:?GEMINI_API_KEY 가 필요하다}"
export VOICE="${VOICE:-Zephyr}"                        # かな·기사·단어가 같은 화자여야 한다
export MODEL="${MODEL:-gemini-3.1-flash-tts-preview}"  # 2.5 로 바꾸면 음색이 달라져 섞인다
ROUNDS="${ROUNDS:-300}"
IDLE_WAIT="${IDLE_WAIT:-2700}"   # 이유를 모르는 정체. 45분 쉰다
LOG="${TMPDIR:-/tmp}/jlpt-audio-round.log"
HIST="${TMPDIR:-/tmp}/jlpt-audio-history.log"   # 회차 로그는 다음 회차가 덮는다. 원인 추적용으로 쌓아 둔다

# 두 세션이 같은 저장소를 본다. 동시에 돌면 같은 덩어리를 둘이 만들어 요청이 두 배로 든다.
# mkdir 은 원자적이라 잠금으로 쓴다.
LOCK="${TMPDIR:-/tmp}/jlpt-audio-drive.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  held=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$held" ] && kill -0 "$held" 2>/dev/null; then
    echo "이미 돌고 있다 (pid $held). 둘이 돌면 같은 단어를 두 번 만든다."
    exit 1
  fi
  echo "죽은 잠금을 치운다 (pid ${held:-?})"
  rm -rf "$LOCK"
  mkdir "$LOCK" || exit 1
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

count() { ls -1 "$1"/*.opus 2>/dev/null | wc -l | tr -d ' '; }

run_until() {                     # $1=설명 $2=디렉터리 $3=목표 수 $4.. = 명령
  local label="$1" dir="$2" goal="$3"; shift 3
  echo "=== $label ==="
  for i in $(seq 1 "$ROUNDS"); do
    local before after rc wait
    before=$(count "$dir")
    [ "$before" -ge "$goal" ] && { echo "$label 완료 $before/$goal"; return 0; }
    "$@" > "$LOG" 2>&1
    rc=$?
    { echo "### $label 회차 $i · 종료 $rc · $(date '+%m-%d %H:%M')"; cat "$LOG"; } >> "$HIST"
    tail -4 "$LOG"
    after=$(count "$dir")
    echo "-- 회차 $i: $before → $after  (종료 $rc, $(date '+%H:%M'))"
    [ "$after" -ge "$goal" ] && { echo "$label 완료"; return 0; }
    if [ "$rc" = 3 ]; then
      # retryDelay 가 23시간을 가리켜도 실제 용량은 몇 시간 안에 돌아온다 — 상한을 둔다
      wait="$IDLE_WAIT"
      echo "-- 일일 한도 · $((wait / 60))분 뒤 다시 찔러 본다"
      sleep "$wait"
    elif [ "$after" = "$before" ]; then
      echo "-- 진전 없음 · $((IDLE_WAIT / 60))분 대기"
      sleep "$IDLE_WAIT"
    else
      sleep 20
    fi
  done
  echo "$label 미완: $(count "$dir")/$goal"
}

run_until "읽기 기사" assets/audio/read 396 node tools/build-reading-audio.js
# 한자 예시 3,718개를 먼저 끝냈다(한자 모드가 그걸 쓴다). 이제 단어 덱 전체 8,017 읽기.
# 빠진 4,299개는 대부분 카나 단어와 외래어라 어떤 한자의 대표 단어도 될 수 없었다 —
# どうして·やはり·ペン·ニュース 같은 것들이다.
run_until "단어(덱 전체)" assets/audio/word 8017 env SCOPE=all node tools/build-word-audio.js
# 한자 카드의 음독·훈독. 훈독은 대부분 단어라 이미 있고(2,448종 중 1,620) 음독 카나가 거의 다 빈다.
# 같은 word/ 디렉터리에 읽기 그대로 저장하니 목표 수는 덱 전체(8,017) + 새로 만들 것이다.
run_until "한자 음독·훈독" assets/audio/word 9181 env SCOPE=kanjiread node tools/build-word-audio.js

echo "=== 마무리 ==="
MANIFEST=1 node tools/build-reading-audio.js
CHECK=1 node tools/build-reading-audio.js | tail -2
echo "읽기 $(count assets/audio/read)/396 · 단어 $(count assets/audio/word)/8017"
echo "커밋 전에 git status 를 확인할 것. 회차별 로그: $HIST"
