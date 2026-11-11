---
name: design-tokens
description: 사용자의 3층 디자인 토큰(C:\workspace\design-tokens — --color-bg-surface, --space-unit, --font-body, data-theme, data-density, ui.css의 .btn .field .panel .chip) 규칙과 찾아보기·검사 도구. 이 토큰을 쓰는 프로젝트(wakaaka, anima-webgpu-next 등)에서 CSS·HTML·JSX 스타일을 쓰거나 고칠 때, 새 화면·컴포넌트를 만들 때, 기존 사이트에 토큰을 처음 적용할 때, 테마·밀도 전환을 붙일 때, 토큰을 추가·수정하거나 프로젝트의 토큰 사본을 갱신할 때 쓴다. Use for any styling work in a project that defines --space-unit or links design-tokens/tokens.css, even if the user does not mention tokens.
---

# design-tokens

원본 저장소: `C:\workspace\design-tokens` (README.md에 전체 설명과 결정 기록).
프로젝트는 원본을 직접 쓰지 않고 **사본**을 들고 있다. 사본은 원본보다 오래됐을 수 있다.
그래서 아래 도구는 항상 **그 프로젝트의 사본을 기준으로** 돌린다.

## 1. 먼저 확인할 것

**프로젝트 자체 규칙이 이 문서보다 우선한다.** 프로젝트의 CLAUDE.md·DESIGN 문서와 스타일 검사 스크립트
(`package.json`의 lint 항목 등)를 먼저 찾는다. 예: wakaaka는 `npm run lint:css`가 있고, 고유 치수도 실패로 보며,
앱 CSS는 2층과 앱 3층만 쓰게 한다. 이 문서와 다르면 프로젝트 쪽을 따른다.

**토큰 사본 찾기**:

```bash
grep -rl --include='*.css' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.claude -e '--space-unit:' .
```

| 찾은 것 | 형태 | 아래에서 `<토큰>`으로 쓸 경로 |
|---|---|---|
| `…/design-tokens/tokens/1-primitives.css` | 폴더 사본 (예: wakaaka `apps/web/src/design-tokens`) | 그 `design-tokens` 폴더 |
| 파일 하나 (예: anima `web/css/tokens.css`) | `bundle.mjs`로 만든 번들 | 그 파일 |
| 없음 | 아직 적용 전 | 4절을 따른다 |

폴더 사본도 번들도 **직접 고치지 않는다.** 바꿀 것이 있으면 5절을 따른다.

## 2. 토큰 고르기

```bash
node C:/workspace/design-tokens/scripts/manifest.mjs --tokens <토큰> 배경 --layer 2   # 검색어(이름·설명·묶음, 모두 포함) + 층
node C:/workspace/design-tokens/scripts/manifest.mjs --tokens <토큰> danger           # 의도 색 한 벌
node C:/workspace/design-tokens/scripts/manifest.mjs --tokens <토큰> --json           # 기계용
```

한 줄에 `층 · 이름 · 라이트|다크 해석값 · px · 설명 · [묶음]`이 나온다. CSS 파일을 통째로 읽기 전에 이걸 쓴다.
`--tokens`를 빼면 원본 기준이라, 그 프로젝트 사본에 없는 토큰이 나올 수 있다.

| 층 | 예 | 앱 코드에서 |
|---|---|---|
| 1 팔레트 색 | `--gray-22` `--blue-72` | **쓰지 않는다.** 테마가 바뀌어도 따라 바뀌지 않는다 |
| 1 스케일 | `--space-4` `--radius-md` `--font-size-sm` | 맞는 2층 역할(`--gap-*` `--inset-*` `--font-*`)이 없을 때 쓴다 |
| 2 역할 | `--color-bg-surface` `--color-fg-muted` `--gap-md` `--font-body` | **기본으로 쓴다** |
| 3 컴포넌트 | `--button-padding-y` `--panel-radius` `--control-height` | 그 컴포넌트를 구현할 때 쓴다 |

## 3. 쓸 때 규칙

규칙마다 실제로 화면이 깨졌거나 대비가 미달이었던 이유가 있다.

**색**
- 날 색(`#hex`, `rgb()`, 색 이름)을 쓰지 않는다. 새 색도 만들지 않는다. hover/press는 `-hover`/`-press`, 옅은 배경은 `-subtle`을 쓴다.
- 의도 색 한 벌: `--color-{accent,success,warning,danger}` 는 **글자·아이콘**용, `-solid`는 **채움**용이다(위 글자는 `--color-on-X`).
  둘은 단계가 다르다. 글자색을 채움으로, 채움색을 글자로 쓰지 않는다.
- 의도 색 글자는 페이지·패널·움푹한 영역과 그 위의 자기 `-subtle`·`-subtle-hover` 배경에서 4.5:1이 보장된다.
  그 밖의 조합(예: `fg-muted` 글자 + `bg-muted` 바탕은 다크 4.30:1)은 보장되지 않으니, 새 조합은 스타일 가이드의 대비 표에 추가해서 확인한다.
- 뜻 없는 분류(태그 종류)는 `--color-label-{blue,red,purple,green,orange}`를 쓰고, 무엇이 어느 색인지는 앱 3층에 둔다(`--tag-artist: var(--color-label-red)`).
- 테두리는 둘로 나뉜다. 입력창·칩·테두리 버튼처럼 **선이 있어야 컨트롤인 줄 아는 곳**은 `--color-border-control`(3:1 보장),
  패널·구분선 같은 **장식선**은 `--color-border`.

**크기와 배치**
- 한 줄 컨트롤(버튼·입력창·셀렉트·아이콘 버튼)은 높이가 하나다(`--control-height`, 기본 36px). 새 컨트롤도 이 높이에 맞춘다.
- 컴포넌트에 바깥 margin을 주지 않는다. 간격은 부모가 `gap`, `--field-gap`(필드↔필드), `--label-gap`(라벨↔입력), `--action-gap`(필드 묶음↔버튼)으로 정한다.
  왜: margin 있는 버튼이 flex 행에 들어가면 혼자 아래로 처진다(anima에서 24곳).
- 라벨 줄 높이는 하나(`--field-label-height`). 라벨 줄에 넣는 입력은 `.input-sm`을 쓴다.
- 글자는 역할 묶음으로 쓴다: `font: var(--font-body)`. 크기·굵기·행간을 따로 박지 않는다.
- 색·시간 날 값은 금지, 그 화면에만 있는 길이는 "고유 치수"로 허용된다(프로젝트 규칙이 더 엄격하면 그쪽을 따른다).

**컴포넌트**
- `ui.css` 클래스가 프로젝트에 있으면 새로 짜기 전에 쓴다: `.btn` `.btn-secondary|ghost|danger|sm` `.icon-btn` `.field` `.label`
  `.input` `.input-sm` `select.input` `.panel` `.panel-title` `.chip-group` `.chip[aria-pressed]` `.badge-*` `.progress` `.popover` `.dialog` `.code-block` `.thumb`.
- 변형은 지역 변수(`--_bg` 등)만 덮어쓰고, hover·active·disabled 규칙은 기본 클래스에 한 번만 둔다.
- 포커스 표시를 `outline: none`으로 지우지 않는다. 다른 표시로 바꿀 때는 `outline: … solid transparent`로 둔다(고대비 모드에서 남는다).
- 테마·밀도는 속성으로 바꾼다: `data-theme="light|dark"`, `data-density="compact|comfortable"`. 어느 요소에 붙여도 하위 트리만 바뀐다.
  테마 전환 버튼은 `theme.js`와 `.theme-toggle`을 쓴다(원본 README "테마" 절).

## 4. 기존 사이트에 처음 적용할 때 (anima에서 검증한 순서)

1. 기준선 캡처: 요소별 계산 스타일·위치를 저장한다.
2. **정확히 같은 값만** 토큰으로 바꾸고 기준선과 비교해 차이 0을 확인한다.
3. 스케일 밖 값을 스케일에 맞춘다. 바꾼 곳만 달라졌는지 확인한다.
4. 인라인 스타일을 클래스로 옮긴다. 같은 방식으로 확인한다.

함정:
- 다크 전용 사이트는 `<html data-theme="dark">`로 고정한다. 안 그러면 OS 라이트 사용자에게 갑자기 라이트가 뜬다.
- 토큰을 넣으면 `color-scheme`이 켜져서 체크박스·스크롤바 모양이 바뀐다. `accent-color`도 같이 정한다.
- JS가 `el.style.display = ""`로 보이게 하는 요소의 `display: none`을 클래스로 옮기지 않는다.

## 5. 맞는 토큰이 없거나, 사본이 오래됐을 때

- **이 앱에서만 쓰는 결정**이면 앱 쪽 3층 토큰으로 둔다(프로젝트가 정한 파일, 없으면 앱 CSS 맨 위 `:root` 블록).
- **여러 앱에 쓰일 것**이면 원본에 추가한다. 다른 저장소이므로 **사용자에게 먼저 묻는다.**
  방법은 원본 README "확장하는 법"에 있다. 고친 뒤 `node scripts/check.mjs`를 돌리고 스타일 가이드(`node scripts/serve.mjs` → :5180)의 대비 표가 전부 통과인지 본다.
- **사본 갱신도 사용자에게 먼저 묻는다.** 원본이 바뀌면 색·높이가 달라질 수 있어서 앱 화면이 변한다. 갱신 전후 화면을 비교한다.
  - 폴더 사본: 원본 파일을 다시 복사하고, 프로젝트의 출처 기록(wakaaka는 `SOURCE.md`의 커밋 해시)을 갱신한다.
  - 번들: `node C:/workspace/design-tokens/scripts/bundle.mjs <번들 파일 경로>`

## 6. 끝내기 전에 검사

프로젝트에 자체 검사가 있으면 그것을 돌린다. 없으면:

```bash
node C:/workspace/design-tokens/scripts/check.mjs --tokens <토큰> <바꾼 .css/.html 파일들>
```

- 실패 0이어야 한다. 잡는 것: 색·시간 리터럴, 정의 안 된 토큰(오타이거나 사본에 없는 토큰), 앱 코드의 1층 팔레트 색 참조.
- "고유 치수" 목록은 실패가 아니다. 새로 생긴 항목이 정말 그 화면만의 치수인지 보고 사용자에게 알린다.
- **잡지 못하는 것**은 직접 읽어서 확인한다: `white`·`black` 같은 색 이름, 굵기·행간·z-index·opacity 숫자, JS 객체의 숫자 값(`padding: 12`).
  `.html`은 `<style>`과 `style` 속성만 본다. `.jsx`·`.tsx`·`.ts`를 넘기면 파일 전체를 글자로 훑어서 hex 색과 `ms`는 잡지만 그 밖은 놓친다.
- 화면을 바꿨으면 다크·라이트 둘 다 눈으로 확인한다.
