#!/usr/bin/env bash
# 운영 서버의 가장 새 백업을 이 PC로 가져온다 (DESIGN 10절: 서버 백업은 같은 디스크라 디스크 고장에 못 버틴다).
#   deploy/prod-backup-pull.sh
# 받을 폴더: WAKAAKA_BACKUP_LOCAL(기본 ~/wakaaka-backups, 저장소 밖). 이미 같은 이름이 있으면 건너뛴다. 받은 뒤 sha256을 대조한다.
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
LOCAL="${WAKAAKA_BACKUP_LOCAL:-$HOME/wakaaka-backups}"

run() { if [ "$HOST" = local ]; then bash -c "$1"; else ssh "$HOST" "bash -c $(printf '%q' "$1")"; fi; }

latest=$(run "cd $DIR/backups && ls -1t wakaaka-*.dump 2>/dev/null | head -1")
[ -n "$latest" ] || { echo "no backups on server" >&2; exit 1; }
case "$latest" in *[!A-Za-z0-9._-]*) echo "unexpected backup name: $latest" >&2; exit 1 ;; esac
mkdir -p "$LOCAL"
if [ -f "$LOCAL/$latest" ]; then echo "already have $latest"; exit 0; fi
sum=$(run "cd $DIR/backups && sha256sum $latest" | cut -d' ' -f1)
run "cat $DIR/backups/$latest" > "$LOCAL/$latest.tmp"
echo "$sum  $LOCAL/$latest.tmp" | sha256sum -c --quiet
mv "$LOCAL/$latest.tmp" "$LOCAL/$latest"
echo "pulled $latest ($(wc -c < "$LOCAL/$latest") bytes) to $LOCAL"
