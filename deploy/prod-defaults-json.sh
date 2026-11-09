#!/usr/bin/env bash
# 운영 서버에 미리 만든 기본 와일드카드 JSON을 넣는다 (DESIGN 10절 "기본 와일드카드", 헤더 없는 형식, 2026-11-09).
#   deploy/prod-defaults-json.sh <defaults.json>
# prod-defaults.sh(서버에서 생성기를 돌림, 옛 CSV)와 달리 fixtures/tools/defaults2/로 만든 JSON을 보낸다.
# 전용 계정 wakaaka에 살아 있는 와일드카드가 하나라도 있으면 멈춘다(지운 것은 괜찮다: 옛 기본을 지우고 바꿔 넣는 경우).
# 옛 기본 지우기는 deploy/prod-delete-wildcards.sh. 이름은 지운 것과 겹쳐도 된다(DESIGN 2절 5항).
# WAKAAKA_PROD_SSH=local 이면 compose 대신 DATABASE_URL로 바로 넣는다(리허설용).
set -euo pipefail
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}"
JSON="${1:?usage: deploy/prod-defaults-json.sh <defaults.json>}"
[ -f "$JSON" ] || { echo "not found: $JSON" >&2; exit 1; }
sum=$(sha256sum "$JSON" | cut -d' ' -f1)
q="select count(*) from wildcard w join owner o on o.id = w.owner_id where lower(o.username) = 'wakaaka' and w.deleted_at is null"

if [ "$HOST" = local ]; then
  n=$(psql "$DATABASE_URL" -Atc "$q" 2>/dev/null || docker exec wakaaka-pg psql "$(echo "$DATABASE_URL" | sed 's#127.0.0.1:54329#127.0.0.1:5432#')" -Atc "$q")
  if [ "$n" != 0 ]; then echo "account wakaaka still has $n live wildcards; delete them first" >&2; exit 1; fi
  node apps/api/src/seed.ts "$JSON" < /dev/null | tail -1
  exit 0
fi

run() { ssh "$HOST" "bash -c $(printf '%q' "$1")"; }
n=$(run "cd $DIR && docker compose -p $PROJECT exec -T postgres psql -U wakaaka -d wakaaka -Atc \"$q\"")
if [ "$n" != 0 ]; then echo "account wakaaka still has $n live wildcards; delete them first (deploy/prod-delete-wildcards.sh wakaaka)" >&2; exit 1; fi

echo "sending defaults (sha256 ${sum:0:12}, $(wc -c < "$JSON") bytes)"
remote="set -euo pipefail; mkdir -p $DIR/data; cd $DIR/data; cat > defaults.json.tmp; echo \"$sum  defaults.json.tmp\" | sha256sum -c --quiet; chmod 644 defaults.json.tmp; mv defaults.json.tmp defaults.json"
ssh "$HOST" "bash -c $(printf '%q' "$remote")" < "$JSON"
run "cd $DIR && docker compose -p $PROJECT exec -T app node apps/api/src/seed.ts /data/defaults.json | tail -1"
