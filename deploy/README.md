# deploy

배포 스크립트. 이 PC의 Git Bash에서 돌리고, ssh로 서버(Docker Compose가 있는 리눅스)에 보낸다.

## 처음 설정

`deploy/local.env.example`을 `deploy/local.env`로 복사해 ssh 호스트(`~/.ssh/config` 별칭)와 태그 CSV 경로를 적는다. `local.env`는 저장소에 넣지 않는다. 같은 이름의 환경 변수를 주면 그쪽이 우선한다.

`WAKAAKA_*_SSH=local`이면 ssh 없이 이 PC Docker에서 리허설한다. 이때는 `MSYS_NO_PATHCONV=1`을 붙인다(MSYS가 `/data/…` 같은 인자를 Windows 경로로 바꾼다).

## 테스트 서버

- 위치: 서버의 `~/docker/wakaaka-test` (compose 프로젝트 `wakaaka-test`), 포트 8490. 바깥에서는 Cloudflare Tunnel로 연다.
- `test-up.sh`: 작업 트리(`git ls-files` 기준, 커밋하지 않은 변경 포함)를 `~/docker/wakaaka-test/src`로 보낸 뒤 서버에서 빌드하고 띄운다.
- `test-reset.sh`: DB 볼륨을 비우고 시드를 다시 넣는다. 끝에서 `test-tags.sh`를 부른다.
- `test-tags.sh`: 태그 CSV(`WAKAAKA_TAGS_CSV`)를 `~/docker/wakaaka-test/data/`로 보내고(같은 해시면 건너뜀) 컨테이너 안에서 가져온다(같은 데이터 버전이면 건너뜀). CSV는 저장소에 넣지 않고, compose가 `data/`를 app의 `/data`에 읽기 전용으로 붙인다.
- 브라우저 확인은 터널 주소(HTTPS)로 한다. LAN 주소는 HTTP라 Secure 세션 쿠키가 남지 않는다.

환경 변수: `WAKAAKA_TEST_SSH`(필수), `WAKAAKA_TEST_DIR`(기본 `~/docker/wakaaka-test`), `WAKAAKA_TEST_PROJECT`(기본 `wakaaka-test`), `WAKAAKA_TEST_PORT`(기본 `8490`).

## 이미지 (`Dockerfile`)

두 단계다. (1) 웹만 `vite build`, (2) 실행 이미지에 API `.ts`와 (1)의 `apps/web/dist`. 실행 이미지는 `WEB_DIST`로 웹을 같이 서빙한다(HTML에 CSP `default-src 'self'`).

## 운영 서버 (DESIGN 10절 "운영 배포")

- 위치: 서버의 `~/docker/wakaaka` (compose 프로젝트 `wakaaka`), 앱 `127.0.0.1:8491`(LAN에도 열지 않음).
- 터널은 서버 호스트의 cloudflared(systemd)가 `http://127.0.0.1:8491`로 들어온다. compose에는 터널을 두지 않는다.
- 서버 폴더: `compose.yml`, `.env`(`POSTGRES_PASSWORD`·`WAKAAKA_PORT`·`COMPOSE_PROJECT_NAME`, 권한 600, 저장소에 없음), `src/`(배포한 커밋), `data/`(태그 CSV), `backups/`, `deployed`(배포 기록), 서버 스크립트 4개(아래).

### 이 PC에서

| 스크립트 | 하는 일 |
|---|---|
| `prod-up.sh` | 커밋된 `HEAD`를 `git archive`로 보내 빌드하고 띄운다. 작업 트리가 깨끗하지 않으면 멈춘다. 처음이면 `.env`를 만들고, DB가 돌고 있으면 배포 직전 백업(`pre-deploy`). 이미지 태그 `latest`와 `<커밋>`(최근 5개만 남김) |
| `prod-tags.sh` | 태그 CSV를 보내고 가져온다(`test-tags.sh`와 같은 방식) |
| `prod-defaults.sh` | 빈 DB에 기본 와일드카드를 전용 계정 `wakaaka`로 넣는다(DESIGN 10절). 이미 있으면 멈춘다 |
| `prod-admin.sh <명령> [인자] [--yes]` | 관리 CLI(`apps/api/src/admin.ts`). `help`로 목록. 바꾸는 명령은 `--yes`가 없으면 드라이런 |
| `prod-backup-pull.sh` | 서버의 가장 새 백업을 이 PC `~/wakaaka-backups`로 가져와 sha256을 대조한다 |
| `prod-cron.sh [--remove]` | 서버 crontab에 매일 04:17 백업을 넣는다 |

`~`가 든 값은 따옴표로 넘긴다(`WAKAAKA_PROD_DIR='~/docker/wakaaka-test'`). 따옴표가 없으면 Git Bash가 이 PC의 홈으로 펼친다.

환경 변수: `WAKAAKA_PROD_SSH`(필수, `local`이면 이 PC), `WAKAAKA_PROD_DIR`(기본 `~/docker/wakaaka`), `WAKAAKA_PROD_PROJECT`(기본 `wakaaka`), `WAKAAKA_PROD_PORT`(기본 `8491`). 리허설 때만 `WAKAAKA_PROD_REHEARSE_DIRTY=1`(local에서 커밋하지 않은 변경으로).

### 서버에서 (`~/docker/wakaaka`, `prod-up.sh`가 `deploy/prod/`에서 복사)

| 스크립트 | 하는 일 |
|---|---|
| `./backup.sh [이름표]` | `pg_dump -Fc` 전체를 `backups/`에(읽히는지 `pg_restore --list`로 본 뒤), 14일 지난 것 삭제 |
| `./restore-check.sh [덤프]` | 덤프를 네트워크 없는 임시 Postgres에 풀어 표마다 행 수·내용 md5를 운영 DB와 대조. 인자가 없으면 지금 백업을 만들어 확인 |
| `./restore.sh <덤프> [--yes]` | 복구: restore-check → 지금 DB 백업(`pre-restore`) → app 정지 → `pg_restore --clean --if-exists --single-transaction` → app 시작 |
| `./rollback.sh [<커밋> --yes]` | 앱을 옛 이미지로. 인자 없이 배포 기록과 남은 태그. DB는 그대로(스키마가 바뀐 배포면 `pre-deploy` 백업을 함께 복구) |

### 처음 배포 순서

1. 이 PC: `deploy/prod-up.sh` → `deploy/prod-tags.sh` → `deploy/prod-defaults.sh` → 서버에서 `curl -s http://127.0.0.1:8491/health`.
2. 서버의 cloudflared ingress에 운영 호스트 이름 → `http://127.0.0.1:8491`, 테스트 호스트 이름 → `http://localhost:8490`을 더하고 재시작한다. Cloudflare 쪽에서 속도 제한, `/assets/*` Cache Rule, 자동 삽입 스크립트 끄기를 설정한다(DESIGN 9·10절).
3. 이 PC: 터널 두 주소에서 `/health`, 응답 헤더, 운영은 빈 DB, 테스트는 기존 데이터인지 확인.
4. `deploy/prod-cron.sh`(매일 백업).
