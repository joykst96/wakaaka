#!/usr/bin/env bash
# 운영 DB 백업 (DESIGN 10절 "운영 배포"). 서버 ~/docker/wakaaka에서 돈다(prod-up.sh가 복사한다).
#   ./backup.sh [이름표]      이름표 기본 daily. prod-up.sh는 배포 직전에 pre-deploy로 부른다.
# pg_dump -Fc 전체를 backups/에 만들고, pg_restore --list로 읽히는지 본 뒤 이름을 바꾼다(반쪽 파일이 남지 않게).
# WAKAAKA_BACKUP_KEEP_DAYS(기본 14)일 지난 덤프를 지운다. crontab에서 부를 수 있게 자기 폴더로 cd한다.
set -euo pipefail
cd "$(dirname "$0")"
# 프로젝트 이름은 prod-up.sh가 .env에 적은 COMPOSE_PROJECT_NAME(없으면 wakaaka). WAKAAKA_PROJECT로 덮어쓸 수 있다
PROJECT="${WAKAAKA_PROJECT:-$(sed -n "s/^COMPOSE_PROJECT_NAME=//p" .env 2>/dev/null | tail -1)}"
PROJECT="${PROJECT:-wakaaka}"
KEEP_DAYS="${WAKAAKA_BACKUP_KEEP_DAYS:-14}"
label="${1:-daily}"
case "$label" in *[!a-z0-9-]*|"") echo "label must be [a-z0-9-]" >&2; exit 1 ;; esac

umask 077
mkdir -p backups
f="backups/wakaaka-$(date +%Y%m%d-%H%M%S)-$label.dump"
trap 'rm -f "$f.tmp"' EXIT
docker compose -p "$PROJECT" exec -T postgres pg_dump -U wakaaka -d wakaaka -Fc > "$f.tmp"
docker compose -p "$PROJECT" exec -T postgres pg_restore --list < "$f.tmp" > /dev/null
mv "$f.tmp" "$f"
find backups -maxdepth 1 -name 'wakaaka-*.dump' -mtime "+$KEEP_DAYS" -print -delete
echo "$(date -Is) backup $f $(wc -c < "$f") bytes"
