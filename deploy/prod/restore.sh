#!/usr/bin/env bash
# 운영 DB 복구 (DESIGN 10절 "운영 배포"). 서버 ~/docker/wakaaka에서 돈다. 지금 DB를 덤프 시점으로 되돌린다.
#   ./restore.sh <덤프>          할 일만 보여 준다
#   ./restore.sh <덤프> --yes    실행
# 순서: 덤프가 풀리는지 restore-check.sh로 먼저 본다 → 지금 DB를 backup.sh pre-restore로 백업 → app을 멈춘다
#   → pg_restore --clean --if-exists --single-transaction(실패하면 아무것도 바뀌지 않음) → app을 띄우고 healthy를 기다린다.
set -euo pipefail
cd "$(dirname "$0")"
# 프로젝트 이름은 prod-up.sh가 .env에 적은 COMPOSE_PROJECT_NAME(없으면 wakaaka). WAKAAKA_PROJECT로 덮어쓸 수 있다
PROJECT="${WAKAAKA_PROJECT:-$(sed -n "s/^COMPOSE_PROJECT_NAME=//p" .env 2>/dev/null | tail -1)}"
PROJECT="${PROJECT:-wakaaka}"
dump="${1:-}"
[ -n "$dump" ] && [ -f "$dump" ] || { echo "usage: ./restore.sh <dump> [--yes]" >&2; exit 1; }
if [ "${2:-}" != "--yes" ]; then
  echo "would restore $dump ($(wc -c < "$dump") bytes) into project $PROJECT:"
  echo "  restore-check, backup pre-restore, stop app, pg_restore --clean --if-exists --single-transaction, start app"
  echo "dry run: nothing changed. add --yes to do it"
  exit 0
fi

echo "== check that the dump restores"
WAKAAKA_PROJECT="$PROJECT" ./restore-check.sh "$dump" | tail -1
echo "== backup the current database"
WAKAAKA_PROJECT="$PROJECT" ./backup.sh pre-restore
echo "== stop app"
docker compose -p "$PROJECT" stop app
trap 'echo "restore failed; starting app on the unchanged database"; docker compose -p "$PROJECT" up -d --wait app' ERR
echo "== restore"
docker compose -p "$PROJECT" exec -T postgres pg_restore -U wakaaka -d wakaaka --clean --if-exists --single-transaction --exit-on-error < "$dump"
trap - ERR
echo "== start app"
docker compose -p "$PROJECT" up -d --wait app
echo "restored $dump"
