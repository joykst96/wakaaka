#!/usr/bin/env bash
# 운영 서버에 기본 와일드카드를 넣는다 (DESIGN 10절 "기본 와일드카드", 사용자 결정 2026-11-04).
#   deploy/prod-defaults.sh        prod-up.sh와 prod-tags.sh 뒤에, 빈 DB에 한 번 쓴다.
# 컨테이너 안에서 서버에 있는 태그 CSV(/data/danbooru-tags.csv)로 build-defaults.ts를 돌리고, seed.ts가 전용 계정 wakaaka로
# 일반 저장 경로를 거쳐 넣는다. wakaaka 계정에 와일드카드가 하나라도 있으면(지운 것 포함) 멈춘다(두 번 넣지 않게).
# 넣다가 실패하면 일부만 들어가 있을 수 있다. 첫 배포 직후 빈 DB라면 docker compose -p wakaaka down -v로 비우고 처음부터 한다.
# 환경 변수는 prod-up.sh와 같다(local이면 MSYS_NO_PATHCONV=1).
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}"

remote=$(cat <<REMOTE
set -euo pipefail
cd $DIR
[ -f data/danbooru-tags.csv ] || { echo "no data/danbooru-tags.csv; run prod-tags.sh first" >&2; exit 1; }
n=\$(docker compose -p $PROJECT exec -T postgres psql -U wakaaka -d wakaaka -Atc "select count(*) from wildcard w join owner o on o.id = w.owner_id where lower(o.username) = 'wakaaka'")
if [ "\$n" != 0 ]; then echo "account wakaaka already has \$n wildcards (including deleted); not seeding again" >&2; exit 1; fi
docker compose -p $PROJECT exec -T app node fixtures/tools/build-defaults.ts /data/danbooru-tags.csv
docker compose -p $PROJECT exec -T app node apps/api/src/seed.ts fixtures/out/defaults.json | tail -1
REMOTE
)
if [ "$HOST" = local ]; then bash -c "$remote"; else ssh "$HOST" "bash -c $(printf '%q' "$remote")"; fi
