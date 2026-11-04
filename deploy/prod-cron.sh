#!/usr/bin/env bash
# 운영 서버 crontab에 매일 백업을 넣는다(이미 있으면 바꿔 넣음). 서버의 사용자 crontab을 바꾸므로 사용자 확인 뒤에만 돌린다.
#   deploy/prod-cron.sh            매일 04:17(서버 시각, KST)에 ~/docker/wakaaka/backup.sh, 로그는 backups/backup.log
#   deploy/prod-cron.sh --remove   그 줄만 지운다
# 표시 주석 "# wakaaka-backup"이 붙은 줄만 건드린다.
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
[ "$HOST" = local ] && { echo "cron is not installed in local rehearsal" >&2; exit 1; }
if [ "${1:-}" = "--remove" ]; then
  remote='{ crontab -l 2>/dev/null | grep -v "# wakaaka-backup$" || true; } | crontab -; crontab -l 2>/dev/null || true'
else
  remote='{ crontab -l 2>/dev/null | grep -v "# wakaaka-backup$" || true; echo "17 4 * * * $HOME/docker/wakaaka/backup.sh >> $HOME/docker/wakaaka/backups/backup.log 2>&1 # wakaaka-backup"; } | crontab -; crontab -l'
fi
ssh "$HOST" "bash -c $(printf '%q' "$remote")"
