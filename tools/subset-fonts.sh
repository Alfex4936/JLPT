#!/bin/zsh
# 폰트를 실제 쓰는 글자만 남겨 서브셋. 원본은 assets/fonts/original/ 로 옮겨 보관.
# 선행: node tools/font-charset.js  (tools/charset/*.txt 생성)
set -eu
ROOT=${0:a:h:h}
FONTS=$ROOT/assets/fonts
CS=$ROOT/tools/charset
ORIG=$FONTS/original

[[ -f $CS/word.txt ]] || { echo "tools/charset/*.txt 없음 — node tools/font-charset.js 먼저 실행"; exit 1; }
mkdir -p $ORIG

# 파일 → 문자집합 매핑
sets=(
  "klee-one-japanese-400-normal:word"
  "klee-one-japanese-600-normal:word"
  "noto-sans-jp-japanese-400-normal:jp"
  "noto-sans-jp-latin-400-normal:jp"
  "noto-sans-kr-korean-400-normal:kr"
  "noto-sans-kr-korean-700-normal:kr"
)

total_before=0
total_after=0
for pair in $sets; do
  name=${pair%%:*}
  set=${pair##*:}
  src=$ORIG/$name.woff2
  # 첫 실행이면 원본을 보관 디렉터리로 옮긴다
  [[ -f $src ]] || mv $FONTS/$name.woff2 $src
  before=$(wc -c < $src | tr -d ' ')

  uvx --quiet --from "fonttools[woff]" pyftsubset "$src" \
    --text-file="$CS/$set.txt" \
    --output-file="$FONTS/$name.woff2" \
    --flavor=woff2 \
    --layout-features='kern,liga,palt,vert,vrt2' \
    --no-hinting --desubroutinize \
    --drop-tables+=DSIG

  after=$(wc -c < $FONTS/$name.woff2 | tr -d ' ')
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  printf "%-38s %7.1fKB -> %6.1fKB  (%d%%)\n" $name \
    $((before / 1024.0)) $((after / 1024.0)) $((100 * after / before))
done

printf "\n합계 %.1fMB -> %.1fMB (%d%%)\n" \
  $((total_before / 1048576.0)) $((total_after / 1048576.0)) $((100 * total_after / total_before))
echo "원본 보관: assets/fonts/original/ (git 에는 올리지 않음)"
