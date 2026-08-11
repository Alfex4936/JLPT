#!/bin/zsh
# 번역 웨이브 보조: 유휴 에이전트 pane 회수 + 다음 처리 대상 청크 N개 출력
# usage: tools/wave.sh [N]
set -u
N=${1:-7}
SOCK=$(ls /private/tmp/tmux-501 2>/dev/null | grep claude-swarm | head -1)
ROOT=${0:a:h:h}
export SCRATCH=${SCRATCH:-/private/tmp/claude-501/-Users-ad03208797-Documents-0-github-jlpt/3054c3ae-9a01-4e3d-95dd-2e93197f545b/scratchpad}

if [[ -n "$SOCK" ]]; then
  # 활동 중이지 않은 pane 만 정리 (첫 pane 은 tmux 창 유지용으로 남김)
  panes=(${(f)"$(tmux -L $SOCK list-panes -a -F '#{pane_id}' 2>/dev/null)"})
  for p in ${panes[@]:1}; do
    busy=$(tmux -L $SOCK capture-pane -p -t $p 2>/dev/null | grep -cE 'esc to interrupt')
    [[ "$busy" == "0" ]] && tmux -L $SOCK kill-pane -t $p 2>/dev/null
  done
  echo "panes: $(tmux -L $SOCK list-panes -a -F '#{pane_id}' 2>/dev/null | wc -l | tr -d ' ')"
fi

node $ROOT/tools/next-chunks.js | tail -1 | tr ' ' '\n' | head -$N | tr '\n' ' '
echo
