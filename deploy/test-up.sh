#!/usr/bin/env bash
# 테스트 서버 배포 (DESIGN 12절). 작업 트리를 서버 ~/docker/wakaaka-test/src로 보내고 거기서 빌드해 띄운다.
#   deploy/test-up.sh
# 보내는 파일: git이 추적하는 파일과 무시하지 않은 새 파일(커밋하지 않은 변경 포함), 지운 파일은 뺀다.
# .env가 없으면 서버에서 POSTGRES_PASSWORD를 무작위로 만든다(저장소에는 두지 않는다).
#
# 리허설용 환경 변수: WAKAAKA_TEST_SSH=local 이면 ssh 없이 이 PC에서 돌린다.
#   WAKAAKA_TEST_DIR(기본 ~/docker/wakaaka-test), WAKAAKA_TEST_PROJECT(기본 wakaaka-test), WAKAAKA_TEST_PORT(기본 8490)
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi

HOST="${WAKAAKA_TEST_SSH:?WAKAAKA_TEST_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_TEST_DIR:-~/docker/wakaaka-test}"
PROJECT="${WAKAAKA_TEST_PROJECT:-wakaaka-test}"
PORT="${WAKAAKA_TEST_PORT:-8490}"

cd "$(git rev-parse --show-toplevel)"

remote=$(cat <<EOF
set -euo pipefail
mkdir -p $DIR/data
cd $DIR
rm -rf src.new && mkdir src.new
tar -xzf - -C src.new
rm -rf src && mv src.new src
cp src/deploy/test/compose.yml compose.yml
if [ ! -f .env ]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\n' "\$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .env
fi
WAKAAKA_TEST_PORT=$PORT docker compose -p $PROJECT up -d --build --wait
docker compose -p $PROJECT ps
EOF
)

files() {
  git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
    [ -f "$f" ] && printf '%s\0' "$f"
  done
}

if [ "$HOST" = local ]; then
  files | tar --null -T - -czf - | bash -c "$remote"
else
  files | tar --null -T - -czf - | ssh "$HOST" "bash -c $(printf '%q' "$remote")"
fi
echo "up: project $PROJECT, port $PORT"
