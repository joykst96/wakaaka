# 와카아카 (wakaaka)

프롬프트 와일드카드를 웹에서 편집·저장·공유하고, ComfyUI 노드에서 ID와 seed로 불러 쓰는 서비스.

- 서비스: <https://wakaaka.baepoyong.com>
- 와일드카드 안에 내 것이나 남의 와일드카드를 넣어 **이어서 조합**한다. 남의 것을 넣으면 그 시점 버전을 의존성까지 내 것으로 복사하므로, 원작자가 고쳐도 내 결과는 바뀌지 않는다.
- 같은 와일드카드와 seed면 웹 미리보기, 서버, ComfyUI 노드가 글자 단위로 같은 결과를 낸다. TS 전개기와 Python 전개기가 공통 테스트 세트를 함께 통과한다.
- 모든 와일드카드는 공개다. 둘러보기, 즐겨찾기, 좋아요가 있다.

## 문법

| 용도 | 쓰는 법 |
|---|---|
| 참조 | `${머리색}` (저장할 때 `${w:<ID>}`로 바뀐다) |
| 즉석 선택지 | `{smile\|grin\|smirk}` |
| 보기 가중치 | `{3*silver\|platinum}` (3:1) |
| 이스케이프 | `\{` `\}` `\$` `\`, 선택지 안에서 `\|` |

항목 가중치, 고를 개수, 구분자는 편집기의 항목 목록에서 정한다. 텍스트 보기에서는 한 줄에 항목 하나(`3* red hair`). 자세한 명세는 [docs/SPEC.md](docs/SPEC.md).

## ComfyUI 노드

[comfy-node](comfy-node) 폴더를 `ComfyUI/custom_nodes/wakaaka`로 복사하고 ComfyUI를 다시 시작한다. 설치할 Python 패키지는 없다.

**Wakaaka Wildcard** 노드에 와일드카드 ID(또는 웹 주소)를 넣고 출력 `text`를 `CLIPTextEncode`에 잇는다. 큐에 넣을 때 결과와 lock이 PNG 워크플로에 남아 나중에 같은 결과를 다시 만들 수 있다. 서버에 연결할 수 없으면 캐시로 전개한다. 자세한 것은 [comfy-node/README.md](comfy-node/README.md).

## 구조

| 폴더 | 내용 |
|---|---|
| [`packages/core`](packages/core) | 문서 스키마, 파서, 전개기, 내용 해시, 공통 테스트 세트(`conformance/`) |
| [`apps/api`](apps/api) | Hono API 서버 (PostgreSQL, Kysely) |
| [`apps/web`](apps/web) | Vite + React + CodeMirror 6 편집기와 대시보드 |
| [`comfy-node`](comfy-node) | ComfyUI 커스텀 노드 (Python 표준 라이브러리만) |
| [`deploy`](deploy) | Dockerfile, docker compose, 배포·백업 스크립트 |
| [`fixtures`](fixtures) | 예시 와일드카드 재료(분야별 태그 CSV)와 생성기 |
| [`docs`](docs) | 설계([DESIGN.md](docs/DESIGN.md))와 명세([SPEC.md](docs/SPEC.md)) |

## 개발

Node 22 이상과 Docker가 필요하다. npm workspaces를 쓴다.

```bash
npm install
```

```bash
npm run db:up -w @wakaaka/api
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run dev -w @wakaaka/api
```

```bash
npm run dev -w @wakaaka/web
```

`http://localhost:5173`을 연다(세션 쿠키가 Secure라 `localhost`로 연다). 예시 와일드카드를 넣으려면:

```bash
node fixtures/tools/build-examples.ts
```

```bash
DATABASE_URL=postgres://wakaaka:wakaaka@127.0.0.1:54329/wakaaka_test npm run seed -w @wakaaka/api
```

### 테스트

```bash
npm test
```

타입 검사, 스타일 검사, vitest를 돌린다. API 테스트는 위의 로컬 Postgres가 떠 있어야 한다.

ComfyUI 노드와 Python 전개기는 ComfyUI가 쓰는 Python으로 돌린다.

```bash
python -I -m unittest discover -s comfy-node/tests -t comfy-node
```

### 배포

Docker 이미지 하나(API + 빌드한 웹)와 Postgres를 docker compose로 띄운다. 스크립트와 순서는 [deploy/README.md](deploy/README.md).

## 데이터

- 태그 자동완성과 기본 와일드카드는 Danbooru 태그에 한국어 설명을 붙인 CSV(`danbooru-tags.csv`, 별도 프로젝트)로 만든다. 이 CSV 전체는 저장소에 넣지 않는다.
- `fixtures/materials/`에는 테스트용으로 그중 일부 태그(709줄)만 들어 있다. 출처는 [fixtures/materials/SOURCE.md](fixtures/materials/SOURCE.md).
- `apps/web/src/design-tokens/`는 같은 작성자의 `joykst96/design-tokens` 복사본이다.

## 라이선스

[MIT](LICENSE)
