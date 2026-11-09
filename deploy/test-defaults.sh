#!/usr/bin/env bash
# 테스트 서버에 미리 만든 기본 와일드카드 JSON을 넣는다 (DESIGN 10절 "기본 와일드카드", 헤더 없는 형식, 2026-11-09).
#   deploy/test-defaults.sh <defaults.json>      test-up.sh와 test-tags.sh 뒤에 쓴다.
# 새 CSV의 기본 와일드카드는 생성기가 아니라 일회용 작업(fixtures/tools/defaults2/)으로 만든 JSON이라, 서버에서 만들지 않고 파일을 보낸다.
# 1) JSON을 ~/docker/wakaaka-test/data/defaults.json으로 보낸다(compose가 data/를 app 컨테이너의 /data에 읽기 전용으로 붙인다).
# 2) 전용 계정 wakaaka에 와일드카드가 하나라도 있으면(지운 것 포함) 멈춘다(두 번 넣지 않게). 다시 넣으려면 test-reset.sh로 비운다.
# 3) 컨테이너 안에서 seed.ts가 일반 저장 경로로 넣는다.
set -euo pipefail
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi

HOST="${WAKAAKA_TEST_SSH:?WAKAAKA_TEST_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_TEST_DIR:-~/docker/wakaaka-test}"
PROJECT="${WAKAAKA_TEST_PROJECT:-wakaaka-test}"
JSON="${1:?usage: deploy/test-defaults.sh <defaults.json>}"
[ -f "$JSON" ] || { echo "not found: $JSON" >&2; exit 1; }
sum=$(sha256sum "$JSON" | cut -d' ' -f1)

run() {
  if [ "$HOST" = local ]; then bash -c "$1"; else ssh "$HOST" "bash -c $(printf '%q' "$1")"; fi
}

n=$(run "cd $DIR && docker compose -p $PROJECT exec -T postgres psql -U wakaaka -d wakaaka -Atc \"select count(*) from wildcard w join owner o on o.id = w.owner_id where lower(o.username) = 'wakaaka'\"")
if [ "$n" != 0 ]; then echo "account wakaaka already has $n wildcards (including deleted); not seeding again" >&2; exit 1; fi

echo "sending defaults (sha256 ${sum:0:12}, $(wc -c < "$JSON") bytes)"
remote="set -euo pipefail; mkdir -p $DIR/data; cd $DIR/data; cat > defaults.json.tmp; echo \"$sum  defaults.json.tmp\" | sha256sum -c --quiet; chmod 644 defaults.json.tmp; mv defaults.json.tmp defaults.json"
if [ "$HOST" = local ]; then bash -c "$remote" < "$JSON"; else ssh "$HOST" "bash -c $(printf '%q' "$remote")" < "$JSON"; fi

run "cd $DIR && docker compose -p $PROJECT exec -T app node apps/api/src/seed.ts /data/defaults.json | tail -1"
