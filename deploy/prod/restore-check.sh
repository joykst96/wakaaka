#!/usr/bin/env bash
# 복구 확인 (DESIGN 10절 "운영 배포"). 서버 ~/docker/wakaaka에서 돈다. 운영 DB는 읽기만 한다.
#   ./restore-check.sh            지금 백업을 하나 만들고(이름표 check) 그것으로 확인
#   ./restore-check.sh <덤프>     있는 덤프로 확인(그 뒤 운영 DB가 바뀌었으면 차이가 보인다)
# 덤프를 네트워크 없는 임시 Postgres 컨테이너에 풀고, 표마다 행 수와 내용 md5를 운영 DB와 대조한 뒤 컨테이너를 지운다.
set -euo pipefail
cd "$(dirname "$0")"
# 프로젝트 이름은 prod-up.sh가 .env에 적은 COMPOSE_PROJECT_NAME(없으면 wakaaka). WAKAAKA_PROJECT로 덮어쓸 수 있다
PROJECT="${WAKAAKA_PROJECT:-$(sed -n "s/^COMPOSE_PROJECT_NAME=//p" .env 2>/dev/null | tail -1)}"
PROJECT="${PROJECT:-wakaaka}"
fresh=0
if [ $# -eq 0 ]; then
  out=$(./backup.sh check)
  echo "$out"
  dump=$(printf '%s\n' "$out" | tail -1 | awk '{print $3}')
  fresh=1
else
  dump="$1"
fi
[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 1; }

name="wakaaka-restore-check-$$"
docker run -d --rm --name "$name" --network none -e POSTGRES_USER=wakaaka -e POSTGRES_DB=wakaaka -e POSTGRES_PASSWORD=check postgres:17.11-alpine > /dev/null
trap 'docker stop "$name" > /dev/null' EXIT
for _ in $(seq 60); do docker exec "$name" pg_isready -U wakaaka -d wakaaka -q 2>/dev/null && break; sleep 1; done
# initdb 직후 한 번 재시작하므로 접속이 될 때까지 한 번 더 기다린다
for _ in $(seq 60); do docker exec "$name" psql -U wakaaka -d wakaaka -Atqc 'select 1' > /dev/null 2>&1 && break; sleep 1; done
start=$(date +%s)
docker exec -i "$name" pg_restore -U wakaaka -d wakaaka --no-owner --exit-on-error < "$dump"
echo "restored $dump in $(( $(date +%s) - start ))s"

# 표마다 "이름 행수 md5(행을 글자로 정렬해 이은 것)"
q="select table_name || ' ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text
  || ' ' || (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, chr(10) order by t::text), %L)) as h from public.%I t', '', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
live=$(docker compose -p "$PROJECT" exec -T postgres psql -U wakaaka -d wakaaka -Atqc "$q")
restored=$(docker exec "$name" psql -U wakaaka -d wakaaka -Atqc "$q")
printf '%s\n' "$restored" | awk '{printf "  %-20s %10s  %s\n", $1, $2, substr($3,1,12)}'
if [ "$live" = "$restored" ]; then
  echo "OK: every table matches the live database ($(printf '%s\n' "$restored" | wc -l) tables)"
else
  echo "DIFFERENT from the live database:"
  diff <(printf '%s\n' "$live") <(printf '%s\n' "$restored") || true
  [ "$fresh" = 1 ] && exit 1
  echo "(the dump is older than the live database, so differences are expected)"
fi
