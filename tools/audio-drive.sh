#!/bin/bash
# 음원 생성을 끝까지 밀어붙이는 드라이버. 할당량에 막히면 기다렸다 이어서 만든다.
#
#   GEMINI_API_KEY=... bash tools/audio-drive.sh
#
# 왜 필요한가: Gemini 3.1 Flash TTS 는 Tier 1 에서 RPD 100 · RPM 10 이다. 남은 작업이
# 수백 요청이라 한 번에 끝나지 않는다. 두 생성기 모두 이미 있는 파일을 건너뛰므로
# 몇 번을 돌려도 안전하고, 매번 없는 것만 채운다.
#
# RPD 는 09:00 KST(UTC 자정)에 리셋된다 — 실측값이다(서버의 retryDelay 가 두 번 다 그 시각을 가리켰다).
# 문서에는 태평양 자정이라고 적혀 있으니, 리셋이 어긋나면 이 값을 의심할 것.
set -u
cd "$(dirname "$0")/.." || exit 1

: "${GEMINI_API_KEY:?GEMINI_API_KEY 가 필요하다}"
export VOICE="${VOICE:-Zephyr}"                        # かな·기사·단어가 같은 화자여야 한다
export MODEL="${MODEL:-gemini-3.1-flash-tts-preview}"  # 2.5 로 바꾸면 음색이 달라져 섞인다
ROUNDS="${ROUNDS:-80}"
IDLE_WAIT="${IDLE_WAIT:-2700}"   # 진전이 없으면 = 일일 한도. 45분 쉰다

count() { ls -1 "$1"/*.opus 2>/dev/null | wc -l | tr -d ' '; }

run_until() {                     # $1=설명 $2=디렉터리 $3=목표 수 $4.. = 명령
  local label="$1" dir="$2" goal="$3"; shift 3
  echo "=== $label ==="
  for i in $(seq 1 "$ROUNDS"); do
    local before after
    before=$(count "$dir")
    [ "$before" -ge "$goal" ] && { echo "$label 완료 $before/$goal"; return 0; }
    "$@" 2>&1 | tail -3
    after=$(count "$dir")
    echo "-- 회차 $i: $before → $after  ($(date '+%H:%M'))"
    [ "$after" -ge "$goal" ] && { echo "$label 완료"; return 0; }
    if [ "$after" = "$before" ]; then
      echo "-- 진전 없음(일일 한도로 추정) · $((IDLE_WAIT / 60))분 대기"
      sleep "$IDLE_WAIT"
    else
      sleep 20
    fi
  done
  echo "$label 미완: $(count "$dir")/$goal"
}

run_until "읽기 기사" assets/audio/read 396 node tools/build-reading-audio.js
SCOPE=kanji run_until "단어(한자 예시)" assets/audio/word 3718 env SCOPE=kanji node tools/build-word-audio.js

echo "=== 마무리 ==="
MANIFEST=1 node tools/build-reading-audio.js
CHECK=1 node tools/build-reading-audio.js | tail -2
echo "읽기 $(count assets/audio/read)/396 · 단어 $(count assets/audio/word)/3718"
echo "커밋 전에 git status 를 확인할 것."
