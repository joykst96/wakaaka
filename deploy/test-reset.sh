#!/usr/bin/env bash
# 테스트 서버 DB를 비우고 시드를 다시 넣는다 (DESIGN 12절). test-up.sh로 한 번 띄운 뒤에 쓴다.
#   deploy/test-reset.sh
# 시드: 컨테이너 안에서 fixtures 생성기로 예시 42개를 만들고 sample 계정으로 일반 저장 경로를 거쳐 넣는다.
# 이어서 test-tags.sh로 태그 CSV를 (필요하면 보내고) 가져온다.
# 환경 변수는 test-up.sh와 같다(WAKAAKA_TEST_SSH=local 이면 이 PC에서). 태그 CSV 위치는 WAKAAKA_TAGS_CSV.
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi

HOST="${WAKAAKA_TEST_SSH:?WAKAAKA_TEST_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_TEST_DIR:-~/docker/wakaaka-test}"
PROJECT="${WAKAAKA_TEST_PROJECT:-wakaaka-test}"
PORT="${WAKAAKA_TEST_PORT:-8490}"

remote=$(cat <<EOF
set -euo pipefail
cd $DIR
export WAKAAKA_TEST_PORT=$PORT
docker compose -p $PROJECT down -v
docker compose -p $PROJECT up -d --wait
docker compose -p $PROJECT exec -T app node fixtures/tools/build-examples.ts
docker compose -p $PROJECT exec -T app node apps/api/src/seed.ts fixtures/out/examples.json
EOF
)

if [ "$HOST" = local ]; then
  bash -c "$remote"
else
  ssh "$HOST" "bash -c $(printf '%q' "$remote")"
fi

"$(dirname "$0")/test-tags.sh"
