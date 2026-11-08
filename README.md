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
| 이스케이프 | `\{` `\}` `\$` `\`, 선택지 안에서 `\|`, 항목 맨 앞에서 `\#` |
| 주석 | `#`로 시작하는 행(텍스트 보기의 줄)은 결과에 나오지 않는다. 글자 `#`로 시작하려면 `\#compass` |

항목 가중치, 고를 개수, 구분자는 편집기의 항목 목록에서 정한다. 텍스트 보기에서는 한 줄에 항목 하나(`3* red hair`). 자세한 명세는 [docs/SPEC.md](docs/SPEC.md).

## ComfyUI 노드

노드는 별도 저장소 [joykst96/comfyui-wakaaka](https://github.com/joykst96/comfyui-wakaaka)에 있다. `ComfyUI/custom_nodes`에서 clone하고 ComfyUI를 다시 시작한다. 설치할 Python 패키지는 없다.

```bash
git clone https://github.com/joykst96/comfyui-wakaaka
```

**Wakaaka Wildcard** 노드에 와일드카드 ID(또는 웹 주소)를 넣고 출력 `text`를 `CLIPTextEncode`에 잇는다. 큐에 넣을 때 결과와 lock이 PNG 워크플로에 남아 나중에 같은 결과를 다시 만들 수 있다. 서버에 연결할 수 없으면 캐시로 전개한다. 자세한 것은 노드 저장소의 README.

## 구조

| 폴더 | 내용 |
|---|---|
| [`packages/core`](packages/core) | 문서 스키마, 파서, 전개기, 내용 해시, 공통 테스트 세트(`conformance/`) |
| [`apps/api`](apps/api) | Hono API 서버 (PostgreSQL, Kysely) |
| [`apps/web`](apps/web) | Vite + React + CodeMirror 6 편집기와 대시보드 |
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

Python 전개기(노드 저장소)는 공통 테스트 세트의 사본으로 돈다. 이 저장소의 세트를 바꿨으면 노드 저장소에서 이 세트로 돌려 본 뒤 사본을 갱신한다(노드 저장소 `tests/conformance/SOURCE.md`).

### 배포

Docker 이미지 하나(API + 빌드한 웹)와 Postgres를 docker compose로 띄운다. 스크립트와 순서는 [deploy/README.md](deploy/README.md).

## 데이터

- 태그 자동완성과 기본 와일드카드는 Danbooru 태그에 한국어 설명을 붙인 CSV로 만든다. 지금 쓰는 것은 Hugging Face [mengod-hf/danbooru-tags-kr](https://huggingface.co/datasets/mengod-hf/danbooru-tags-kr)의 `danbooru-tags-kr-2026-11-04.csv`(리비전 `e9092b08`, SHA-256 `6159f204…`)다. 이 CSV는 저장소에 넣지 않는다. 받아서 `data/`(git 무시)에 둔다.
  - 라이선스: 이 데이터셋의 한국어 번역·설명·분류·키워드는 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)이다. 그 밖의 출처(PYU224/tagdb-updater MIT, boorutan/booru-japanese-tag MIT, Danbooru 위키 등)는 데이터셋의 [LICENSE](https://huggingface.co/datasets/mengod-hf/danbooru-tags-kr/blob/main/LICENSE)를 따른다. 사이트에서는 문법 가이드 아래에 출처를 적는다.
  - 바꾼 점: 태그 이름의 공백을 Danbooru 표기(밑줄)로 되돌리고, 키워드 맨 앞의 `<묶음>` 표시는 꺾쇠를 떼어 키워드로 쓴다. 기본 와일드카드는 이 데이터의 분류로 묶은 것이라 설명에 출처와 라이선스를 적는다.
  - 전에 쓰던 별도 프로젝트 `danbooru-tag`의 `danbooru-tags.csv`(헤더 있는 형식)도 그대로 읽을 수 있다.
- `fixtures/materials/`에는 테스트용으로 옛 `danbooru-tags.csv`의 일부 태그(709줄)만 들어 있다. 출처는 [fixtures/materials/SOURCE.md](fixtures/materials/SOURCE.md).
- `apps/web/src/design-tokens/`는 같은 작성자의 `joykst96/design-tokens` 복사본이다.

## 라이선스

[MIT](LICENSE)
