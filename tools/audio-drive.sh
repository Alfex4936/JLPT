#!/bin/bash
# 음원 생성을 끝까지 밀어붙이는 드라이버. 할당량에 막히면 리셋까지 자고 이어서 만든다.
#
#   GEMINI_API_KEY=... bash tools/audio-drive.sh
#
# 왜 필요한가: Gemini 3.1 Flash TTS 는 Tier 1 에서 RPD 100 · RPM 10 이다. 남은 작업이
# 수백 요청이라 한 번에 끝나지 않는다. 두 생성기 모두 이미 있는 파일을 건너뛰므로
# 몇 번을 돌려도 안전하고, 매번 없는 것만 채운다.
#
# 일일 한도에 걸리면 생성기가 종료 코드 3 과 QUOTA_DAY_SECONDS=<초> 를 남긴다 — 서버가
# 알려준 리셋까지의 시간이다. 45분마다 깨서 찔러 보면 그 요청까지 한도에 카운트되므로
# (실측: 100요청 한도에서 클립 33개) 그 값만큼 한 번에 잔다.
set -u
cd "$(dirname "$0")/.." || exit 1

: "${GEMINI_API_KEY:?GEMINI_API_KEY 가 필요하다}"
export VOICE="${VOICE:-Zephyr}"                        # かな·기사·단어가 같은 화자여야 한다
export MODEL="${MODEL:-gemini-3.1-flash-tts-preview}"  # 2.5 로 바꾸면 음색이 달라져 섞인다
ROUNDS="${ROUNDS:-80}"
IDLE_WAIT="${IDLE_WAIT:-2700}"   # 이유를 모르는 정체. 45분 쉰다
LOG="${TMPDIR:-/tmp}/jlpt-audio-round.log"

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
    tail -4 "$LOG"
    after=$(count "$dir")
    echo "-- 회차 $i: $before → $after  (종료 $rc, $(date '+%H:%M'))"
    [ "$after" -ge "$goal" ] && { echo "$label 완료"; return 0; }
    if [ "$rc" = 3 ]; then
      wait=$(sed -n 's/^QUOTA_DAY_SECONDS=\([0-9]*\)$/\1/p' "$LOG" | tail -1)
      wait=$(( ${wait:-3600} + 60 ))
      echo "-- 일일 한도 · 리셋 $(date -v+"${wait}"S '+%m-%d %H:%M') 까지 $((wait / 60))분 대기"
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
run_until "단어(한자 예시)" assets/audio/word 3718 env SCOPE=kanji node tools/build-word-audio.js

echo "=== 마무리 ==="
MANIFEST=1 node tools/build-reading-audio.js
CHECK=1 node tools/build-reading-audio.js | tail -2
echo "읽기 $(count assets/audio/read)/396 · 단어 $(count assets/audio/word)/3718"
echo "커밋 전에 git status 를 확인할 것."
