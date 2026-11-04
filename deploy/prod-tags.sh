#!/usr/bin/env bash
# 운영 서버에 태그 CSV를 보내고 가져온다. 방식은 test-tags.sh와 같다(해시가 같으면 보내지 않고, 데이터 버전이 같으면 가져오지 않음).
#   deploy/prod-tags.sh            prod-up.sh로 한 번 띄운 뒤에 쓴다.
# 환경 변수: WAKAAKA_TAGS_CSV(태그 CSV 경로), 나머지는 prod-up.sh와 같다.
set -euo pipefail
# 서버 주소 같은 개인 설정은 deploy/local.env(저장소에 넣지 않음, 예시는 local.env.example). 이미 정한 환경 변수가 우선한다
if [ -f "$(dirname "$0")/local.env" ]; then . "$(dirname "$0")/local.env"; fi
WAKAAKA_TEST_SSH="${WAKAAKA_PROD_SSH:?WAKAAKA_PROD_SSH (ssh host or "local") is not set; see deploy/local.env.example}" \
WAKAAKA_TEST_DIR="${WAKAAKA_PROD_DIR:-~/docker/wakaaka}" \
WAKAAKA_TEST_PROJECT="${WAKAAKA_PROD_PROJECT:-wakaaka}" \
  exec "$(dirname "$0")/test-tags.sh"
