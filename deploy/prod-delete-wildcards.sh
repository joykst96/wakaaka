#!/usr/bin/env bash
# 운영 서버에서 계정들의 살아 있는 와일드카드를 관리 CLI(delete-wildcard)로 모두 지운다 (DESIGN 9절 "관리", 2026-11-09 기본 와일드카드 교체).
#   deploy/prod-delete-wildcards.sh <아이디>… [--yes]
# --yes가 없으면 지울 목록만 보여 준다(드라이런). 계정은 지우지 않는다(로그인·폴더·즐겨찾기는 남는다).
# 같은 소유자 안에서 참조하는 것은 delete-wildcard가 함께 지우므로, 이미 지워진 ID는 건너뛴다.
# 출력의 restore 줄을 모아 두면 restore-wildcard로 되살릴 수 있다(남이 가져간 복사본은 원래 그대로 남는다).
# WAKAAKA_PROD_SSH=local 이면 이 PC의 compose 대신 DATABASE_URL로 바로 돌린다(리허설용).
set -euo pipefail
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
HOST="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}"
DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}"
PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}"

yes=""
users=()
for a in "$@"; do
  if [ "$a" = --yes ]; then yes="--yes"; else users+=("$a"); fi
done
[ ${#users[@]} -gt 0 ] || { echo "usage: deploy/prod-delete-wildcards.sh <username>… [--yes]" >&2; exit 1; }
for u in "${users[@]}"; do [[ "$u" =~ ^[A-Za-z0-9_]{1,32}$ ]] || { echo "bad username: $u" >&2; exit 1; }; done

remote=$(cat <<REMOTE
set -euo pipefail
if [ "$HOST" = local ]; then admin() { node apps/api/src/admin.ts "\$@" < /dev/null; }
else cd $DIR; admin() { docker compose -p $PROJECT exec -T app node apps/api/src/admin.ts "\$@"; }; fi
for u in ${users[*]}; do
  ids=\$(admin show-account "\$u" | grep -v DELETED | grep -oE '^  [0-9A-Za-z]{12}' | tr -d ' ' || true)
  echo "\$u: live \$(printf '%s\n' \$ids | grep -c . || true)"
  for id in \$ids; do
    if admin show-wildcard "\$id" | grep -q DELETED; then continue; fi
    admin delete-wildcard "\$id" $yes | grep -v '^dry run' || true
  done
done
for u in ${users[*]}; do echo "\$u: live after \$(admin show-account "\$u" | grep -v DELETED | grep -cE '^  [0-9A-Za-z]{12}' || true)"; done
REMOTE
)
if [ "$HOST" = local ]; then bash -c "$remote"; else ssh "$HOST" "bash -c $(printf '%q' "$remote")"; fi
