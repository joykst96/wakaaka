#!/usr/bin/env bash
# 운영 서버의 관리 CLI를 부른다 (DESIGN 9절 "관리"). 인자는 그대로 apps/api/src/admin.ts에 넘긴다.
#   deploy/prod-admin.sh show-wildcard <id>
#   deploy/prod-admin.sh delete-wildcard <id>          드라이런(할 일만 보여 줌)
#   deploy/prod-admin.sh delete-wildcard <id> --yes    실행
# 명령 목록: deploy/prod-admin.sh help. 환경 변수는 prod-up.sh와 같다
# (테스트 서버에 쓰려면 WAKAAKA_PROD_DIR=~/docker/wakaaka-test WAKAAKA_PROD_PROJECT=wakaaka-test).
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}"
args=""
for a in "$@"; do args+=" $(printf '%q' "$a")"; done
remote="cd $DIR && docker compose -p $PROJECT exec -T app node apps/api/src/admin.ts$args"
if [ "$HOST" = local ]; then bash -c "$remote"; else ssh "$HOST" "bash -c $(printf '%q' "$remote")"; fi
