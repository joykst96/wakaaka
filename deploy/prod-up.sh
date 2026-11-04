#!/usr/bin/env bash
# 운영 배포 (DESIGN 10절 "운영 배포"). 커밋된 HEAD만 서버 ~/docker/wakaaka/src로 보내고 거기서 빌드해 띄운다.
#   deploy/prod-up.sh
# - 작업 트리가 깨끗하지 않으면(커밋하지 않은 변경, 추적하지 않는 새 파일) 멈춘다. 보낸 것 = 커밋이 되게.
# - .env가 없으면 서버에서 POSTGRES_PASSWORD를 무작위로 만든다(권한 600, 저장소에 두지 않음).
# - DB가 이미 돌고 있으면 배포 직전에 backup.sh pre-deploy로 백업한다.
# - 이미지에 wakaaka-app:latest와 wakaaka-app:<커밋> 두 태그. 배포한 커밋과 시각을 deployed에 덧붙인다.
#
# 리허설용 환경 변수: WAKAAKA_PROD_SSH=local 이면 ssh 없이 이 PC에서 돈다(Git Bash에서는 MSYS_NO_PATHCONV=1).
#   WAKAAKA_PROD_DIR(기본 ~/docker/wakaaka), WAKAAKA_PROD_PROJECT(기본 wakaaka), WAKAAKA_PROD_PORT(기본 8491),
#   WAKAAKA_PROD_REHEARSE_DIRTY=1(local일 때만: 커밋하지 않은 변경으로 리허설)
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi

HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}"
PORT="${WAKAAKA_PROD_PORT:-8491}"

cd "$(git rev-parse --show-toplevel)"
TREE=HEAD
if [ -n "$(git status --porcelain)" ]; then
  if [ "$HOST" = local ] && [ "${WAKAAKA_PROD_REHEARSE_DIRTY:-}" = 1 ]; then
    # 리허설 전용: 커밋하지 않은 변경(추적·스테이징한 파일)을 ref를 남기지 않는 임시 커밋으로 묶는다
    TREE=$(git stash create)
    echo "rehearsal with uncommitted changes (temporary commit $TREE; untracked files are not included)"
  else
    echo "working tree is not clean; commit first (production gets exactly the committed HEAD):" >&2
    git status --short >&2
    exit 1
  fi
fi
REV=$(git rev-parse --short=12 "$TREE")

remote=$(cat <<REMOTE
set -euo pipefail
mkdir -p $DIR/data $DIR/backups
cd $DIR
rm -rf src.new && mkdir src.new
tar -xf - -C src.new
rm -rf src && mv src.new src
cp src/deploy/prod/compose.yml compose.yml
cp src/deploy/prod/backup.sh src/deploy/prod/restore-check.sh src/deploy/prod/restore.sh src/deploy/prod/rollback.sh .
chmod 755 backup.sh restore-check.sh restore.sh rollback.sh
if [ ! -f .env ]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\n' "\$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .env
  echo "created .env"
fi
# 비밀이 아닌 설정도 .env에 둔다. compose는 .env를 늘 읽으므로 backup.sh·restore.sh·손으로 친 docker compose가
# 같은 포트와 프로젝트를 쓴다(리허설에서 restore.sh의 up이 기본 포트로 컨테이너를 다시 만든 일이 있었다, NOTES)
umask 077
{ grep -v -E '^(WAKAAKA_PORT|COMPOSE_PROJECT_NAME)=' .env || true; printf 'WAKAAKA_PORT=%s\nCOMPOSE_PROJECT_NAME=%s\n' "$PORT" "$PROJECT"; } > .env.new
mv .env.new .env
if docker compose -p $PROJECT ps --status running --services | grep -qx postgres; then
  ./backup.sh pre-deploy
else
  echo "no running database yet; skipping pre-deploy backup"
fi
docker compose -p $PROJECT build app
docker tag wakaaka-app:latest wakaaka-app:$REV
docker compose -p $PROJECT up -d --wait
printf '%s %s\n' "$REV" "\$(date -Is)" >> deployed
# 커밋 태그는 deployed에 적힌 최근 5개만 남긴다(rollback.sh용). 이미지 생성 시각은 빌드마다 같게 찍힐 수 있어 쓰지 않는다(NOTES).
# 쓰는 중인 이미지는 docker가 지우지 않는다
keep=\$(awk '{print \$1}' deployed | tac | awk '!seen[\$0]++' | head -5)
docker images wakaaka-app --format '{{.Tag}}' | grep -v -x -e latest -e "\$keep" | while read -r t; do docker rmi "wakaaka-app:\$t" > /dev/null 2>&1 || true; done
docker compose -p $PROJECT ps
REMOTE
)

echo "deploying $REV ($(git log -1 --format=%s))"
if [ "$HOST" = local ]; then
  git archive --format=tar "$TREE" | bash -c "$remote"
else
  git archive --format=tar "$TREE" | ssh "$HOST" "bash -c $(printf '%q' "$remote")"
fi
echo "up: project $PROJECT, 127.0.0.1:$PORT, $REV"
