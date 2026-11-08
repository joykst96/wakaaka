#!/usr/bin/env bash
# 테스트 서버에 태그 CSV를 보내고 가져온다 (DESIGN 12절, 사용자 결정 2026-11-04: CSV는 저장소에 넣지 않는다).
#   deploy/test-tags.sh            test-up.sh로 한 번 띄운 뒤에 쓴다. test-reset.sh도 끝에서 부른다.
# 1) 이 PC의 CSV를 ~/docker/wakaaka-test/data/danbooru-tags.csv로 보낸다. 같은 해시가 이미 있으면 건너뛴다.
#    compose가 data/를 app 컨테이너의 /data에 읽기 전용으로 붙인다.
#    원본 파일 이름과 상관없이 서버에서는 늘 data/danbooru-tags.csv다(prod-defaults.sh도 이 이름을 읽는다). 형식은 가져오기가 헤더로 가린다.
# 2) 컨테이너 안에서 import-tags.ts를 돌린다. 데이터 버전이 같으면 가져오기도 건너뛴다.
# 환경 변수: WAKAAKA_TAGS_CSV(태그 CSV 경로, 읽기만 한다), 나머지는 test-up.sh와 같다.
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi

HOST="${WAKAAKA_TEST_SSH:?WAKAAKA_TEST_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_TEST_DIR:-~/docker/wakaaka-test}"
PROJECT="${WAKAAKA_TEST_PROJECT:-wakaaka-test}"
CSV="${WAKAAKA_TAGS_CSV:?WAKAAKA_TAGS_CSV (path to danbooru-tags.csv) is not set; see deploy/local.env.example}"

[ -f "$CSV" ] || { echo "tag CSV not found: $CSV" >&2; exit 1; }
sum=$(sha256sum "$CSV" | cut -d' ' -f1)

run() {
  if [ "$HOST" = local ]; then bash -c "$1"; else ssh "$HOST" "bash -c $(printf '%q' "$1")"; fi
}

have=$(run "cd $DIR && mkdir -p data && { sha256sum data/danbooru-tags.csv 2>/dev/null || true; } | cut -d' ' -f1")
if [ "$have" = "$sum" ]; then
  echo "tag CSV already on server (sha256 ${sum:0:12})"
else
  echo "sending tag CSV (sha256 ${sum:0:12}, $(wc -c < "$CSV") bytes)"
  # 임시 파일에 다 받은 뒤 바꾼다(중간에 끊겨도 반쪽 파일이 남지 않게)
  remote="set -euo pipefail; cd $DIR/data; cat > danbooru-tags.csv.tmp; echo \"$sum  danbooru-tags.csv.tmp\" | sha256sum -c --quiet; chmod 644 danbooru-tags.csv.tmp; mv danbooru-tags.csv.tmp danbooru-tags.csv"
  if [ "$HOST" = local ]; then bash -c "$remote" < "$CSV"; else ssh "$HOST" "bash -c $(printf '%q' "$remote")" < "$CSV"; fi
fi

run "cd $DIR && docker compose -p $PROJECT exec -T app node apps/api/src/import-tags.ts /data/danbooru-tags.csv"
