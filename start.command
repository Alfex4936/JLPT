#!/usr/bin/env bash
# 더블클릭용 실행기: 폴더를 로컬 http 로 띄우고 브라우저를 연다.
# file:// 제약(폰트 차단 등)을 확실히 피하는 경로.
set -u
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "python3 을 찾지 못했습니다. index.html 을 그냥 더블클릭해도 동작합니다."
  read -r -p "엔터를 누르면 닫힙니다. " _
  exit 1
fi

# 비어 있는 포트 찾기 (연결이 거부되면 비어 있는 것)
PORT=""
for p in $(seq 8777 8817); do
  if "$PY" -c "import socket,sys;s=socket.socket();sys.exit(0 if s.connect_ex(('127.0.0.1',$p))!=0 else 1)" 2>/dev/null; then
    PORT="$p"; break
  fi
done
if [ -z "$PORT" ]; then
  echo "8777-8817 사이에 빈 포트가 없습니다."
  read -r -p "엔터를 누르면 닫힙니다. " _
  exit 1
fi

echo "JLPT 낱말 셔플"
echo "  http://127.0.0.1:$PORT/"
echo "  이 창을 닫거나 Control-C 를 누르면 서버가 종료됩니다."
echo

"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null' EXIT INT TERM

sleep 1
open "http://127.0.0.1:$PORT/" 2>/dev/null || echo "브라우저에서 http://127.0.0.1:$PORT/ 을 여세요."

wait "$SRV"
