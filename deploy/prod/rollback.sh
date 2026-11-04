#!/usr/bin/env bash
# 앱을 옛 배포 이미지로 되돌린다 (DESIGN 10절 "운영 배포"). 서버 ~/docker/wakaaka에서 돈다. DB는 건드리지 않는다.
#   ./rollback.sh               배포 기록(deployed)과 남아 있는 이미지 태그를 보여 준다
#   ./rollback.sh <커밋> --yes   wakaaka-app:<커밋>을 latest로 다시 붙이고 app만 새로 띄운다(빌드하지 않음)
# 마이그레이션은 되돌리지 않는다. 그 사이 스키마가 바뀌었으면 옛 앱이 새 스키마에서 돌게 되므로, 배포 직전 백업(pre-deploy)을 restore.sh로 함께 되돌린다.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT="${WAKAAKA_PROJECT:-$(sed -n "s/^COMPOSE_PROJECT_NAME=//p" .env 2>/dev/null | tail -1)}"
PROJECT="${PROJECT:-wakaaka}"
rev="${1:-}"
if [ -z "$rev" ]; then
  echo "deployed:"; tail -n 10 deployed 2>/dev/null | sed 's/^/  /'
  echo "images:"; docker images wakaaka-app --format '  {{.Tag}}  {{.ID}}  {{.CreatedSince}}'
  exit 0
fi
case "$rev" in *[!0-9a-f]*) echo "commit must be hex" >&2; exit 1 ;; esac
docker image inspect "wakaaka-app:$rev" > /dev/null 2>&1 || { echo "no image wakaaka-app:$rev" >&2; exit 1; }
if [ "${2:-}" != "--yes" ]; then
  echo "would retag wakaaka-app:$rev as latest and restart app (project $PROJECT). add --yes to do it"
  exit 0
fi
docker tag "wakaaka-app:$rev" wakaaka-app:latest
docker compose -p "$PROJECT" up -d --no-build --wait app
printf '%s %s rollback\n' "$rev" "$(date -Is)" >> deployed
docker compose -p "$PROJECT" ps app
