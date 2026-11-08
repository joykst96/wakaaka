# @wakaaka/web

Vite + React + CodeMirror 6 웹. 왼쪽에 내 와일드카드와 즐겨찾기, 가운데 편집기(목록 보기·텍스트 보기), 오른쪽에 seed 미리보기·의존 트리·사용되는 곳·버전 이력(DESIGN 11절).
미리보기 전개는 브라우저에서 `@wakaaka/core`의 `expand`로 한다. `@wakaaka/core/hash`(node:crypto)는 넣지 않는다.

| 위치 | 내용 |
|---|---|
| `src/lib/` | 순수 함수: 경로·링크 검증(`routes.ts`), 편집 문서 ↔ 저장 문서(`editdoc.ts`), 텍스트 보기와 항목 ID 유지(`textview.ts`), 이름 참조(`names.ts`), 미리보기 묶음·출처 조각·의존 트리(`preview.ts`), 임시 보관(`drafts.ts`), 편집 탭 목록(`tabs.ts`), 폴더 묶기·이름 검사(`folders.ts`), API 클라이언트(`api.ts`) |
| `src/editor/` | CodeMirror 확장(`cm.ts`: 구문 색, 참조 칩, 오류 밑줄, `${` 자동완성), 그림자 루트 칸(`CmEditor.tsx`), 목록 보기, 미리보기, 내보내기(`ExportPanel.tsx`), 패널 |
| `src/pages/`, `src/components/` | 화면과 사이드바(폴더별 목록), 폴더 정리(`FoldersPage.tsx`), 편집 탭 줄, 가져오기·이름 고르기 창 |
| `src/app/` | 라우터, 세션, 메타 캐시, 편집 탭 상태(`tabs.tsx`) |
| `src/styles/` | `components.css`(앱 3층 토큰), `app.css`·`folders.css`(2층과 앱 3층만) |
| `src/design-tokens/` | `joykst96/design-tokens` 복사본. 직접 고치지 않는다(`SOURCE.md`) |

개발(로컬 DB와 API가 떠 있어야 한다. `apps/api/README.md`):

```bash
npm run dev -w @wakaaka/api
```

```bash
npm run dev -w @wakaaka/web
```

`http://localhost:5173`을 연다(`/api`는 3000으로 넘긴다). 쿠키가 Secure라 `localhost`로 연다.

- 테스트: 루트 `npm test`가 `tsc`, 스타일 검사(`npm run lint:css`), vitest를 돌린다.
- 빌드: `npm run build -w @wakaaka/web` → `dist/`. API가 `WEB_DIST`로 받아 같이 서빙한다(CSP `default-src 'self'`).
- CodeMirror는 그림자 루트 안에 띄운다. CSP가 문서의 `<style>` 태그를 막기 때문이다(DESIGN 10절). 편집기 모양은 `editor/theme.ts`에서만 정한다.
