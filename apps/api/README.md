# @wakaaka/api

Hono API 서버. 라우트(`src/app.ts`, 입력 검증) → `src/services/`(로직) → `src/repositories/`(SQL, Kysely).
DB(PostgreSQL)는 이 서버에서만 접근한다. 빌드 없이 Node 22가 `.ts`를 바로 돌린다.

| 파일 | 내용 |
|---|---|
| `src/app.ts` | 경로, 세션 쿠키, 본문 크기 제한, 오류 응답 |
| `src/http.ts` | JSON 본문 읽기(Content-Type, 중복 키, `__proto__`), 오류 형식 |
| `src/services/validate.ts` | 저장 검증(DESIGN 5절): 스키마 → 이름 → 문법 → 참조 → 순환 → 가중치 0 → 정규화 → 경고 → 해시, 충돌 바이트 비교 |
| `src/services/wildcards.ts` | 생성, 새 버전, 삭제, 조회, 가져오기, 둘러보기 예시 출력(저장할 때 seed 0) |
| `src/services/bundle.ts` | 노드용 묶음, lock, resolve, Impact Pack 내보내기(`/api/w/{id}/export?format=impact`) |
| `src/services/social.ts`, `src/repositories/social.ts` | 즐겨찾기, 좋아요, 둘러보기(검색·분류·정렬), 여러 ID 조회, 사용자별 목록 |
| `src/services/folders.ts`, `src/repositories/folders.ts` | 나만 보는 폴더(DESIGN 11절 "폴더"): 만들기, 이름 바꾸기, 지우기, 옮기기, 소유자 검사 |
| `src/services/seed.ts`, `src/seed.ts` | `fixtures/` 예시 시드 |
| `src/db/migrations.ts` | 스키마(DESIGN 6절) |

```bash
npm run db:up -w @wakaaka/api
```

```bash
npm test
```

```bash
DATABASE_URL=postgres://wakaaka:wakaaka@127.0.0.1:54329/wakaaka_test npm start -w @wakaaka/api
```

- 테스트는 테스트마다 스키마를 새로 만든다. DB는 `TEST_DATABASE_URL`(기본 `127.0.0.1:54329`). 다 끝나면 `t_…` 스키마를 지운다.
- 환경 변수 예시는 `.env.example`. 비밀값이 든 `.env`는 커밋하지 않는다.
- 시드: `node fixtures/tools/build-examples.ts` 다음 `DATABASE_URL=… npm run seed -w @wakaaka/api`.
