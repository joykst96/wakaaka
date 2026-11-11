# design-tokens

anima-webgpu 사이트(`web/css/app.css`)의 실제 값을 기준으로, `F:\css`의 디자인 시스템을 참고해서
다시 짠 **3층 디자인 토큰**이다. 새 프론트엔드 프로젝트에 폴더째 복사해서 쓴다. 빌드 단계는 없다.

```
design-tokens/
  tokens.css               ← 이것 하나만 링크하면 토큰 전부 (3층을 @import)
  tokens/
    1-primitives.css       1층 원시값 — 날 값(hex·rem·ms)이 적히는 유일한 곳
    2-semantic.css         2층 역할   — 앱 코드가 쓰는 층 (테마·밀도 대응)
    3-components.css       3층 컴포넌트 — 버튼 여백·패널 라운드 같은 결정
  base.css                 (선택) body·링크·포커스 기본값
  ui.css                   (선택) 3층 토큰을 쓰는 최소 클래스: .btn .input .panel .chip …
  theme.js                 (선택) 테마 기억·렌더 전 적용·전환 API (일반 스크립트, 의존성 없음)
  style-guide.html         눈으로 보는 카탈로그 + 대비 자동 검사
  scripts/check.mjs        규칙 검사 (날 값·참조 방향·오타·색 이름과 명도) — 앱 CSS/HTML도 검사 가능
  scripts/source.mjs       check·manifest 공용: 토큰 읽기 (--tokens로 프로젝트의 사본·번들을 기준으로)
  scripts/bundle.mjs       3층을 파일 하나로 합치기 (배포용)
  scripts/serve.mjs        스타일 가이드 미리보기 서버
  scripts/manifest.mjs     토큰 찾아보기 (이름·층·라이트/다크 해석값·설명, JSON 출력 가능)
  skill/SKILL.md           Claude Code 스킬 원본 — 이 토큰을 쓰는 프로젝트에서 규칙을 알려 준다
```

## 빠른 시작

```html
<link rel="stylesheet" href="design-tokens/tokens.css" />
<link rel="stylesheet" href="design-tokens/base.css" />  <!-- 선택 -->
<link rel="stylesheet" href="design-tokens/ui.css" />    <!-- 선택 -->
```

```css
.my-card {
  padding: var(--inset-lg);
  border: var(--border-width-thin) solid var(--color-border);
  border-radius: var(--panel-radius);
  background: var(--color-bg-surface);
  color: var(--color-fg);
  font: var(--font-body);
}
.my-card small { font: var(--font-caption); color: var(--color-fg-muted); }
```

번들러(Vite 등)에서는 `import "design-tokens/tokens.css"`로 불러오면 된다.

번들러 없이 배포한다면 `@import` 연쇄 요청을 없애도록 파일 하나로 합쳐서 프로젝트에 넣는다
(생성 파일이므로 직접 고치지 않고, 원본을 고친 뒤 다시 만든다).

```bash
node scripts/bundle.mjs ../my-app/css/tokens.css
```

앱 코드에 날 값이 남았는지 검사:

```bash
node scripts/check.mjs ../my-app/css/app.css ../my-app/index.html
```

색·시간 리터럴, 정의되지 않은 토큰, 1층 팔레트 색 직접 참조는 실패로 처리하고, 길이 리터럴은 "고유 치수" 목록으로 보여 준다.
그 화면에만 있는 치수(라이트박스 버튼 크기 등)는 토큰이 아니어도 되지만, 목록으로 드러나게 한다.
`white`·`black` 같은 색 이름, 굵기·행간·z-index 숫자는 잡지 못한다.

앱이 든 토큰 사본(폴더째 복사한 것이나 번들)은 이 저장소보다 오래됐을 수 있다. 그 사본을 기준으로 검사하려면 `--tokens`를 준다.
이 옵션 없이 돌리면 사본에 없는 새 토큰이 "정의됨"으로 통과하고, 화면에서는 조용히 무시된다.

```bash
node scripts/check.mjs --tokens ../my-app/css/tokens.css ../my-app/css/app.css      # 번들 기준
node scripts/check.mjs --tokens ../my-app/src/design-tokens ../my-app/src/app.css   # 폴더 사본 기준
```

스타일 가이드 보기:

```bash
node scripts/serve.mjs
```

브라우저에서 `http://localhost:5180/`을 연다. `file://`로 직접 열어도 화면은 나오지만,
일부 브라우저는 로컬 파일의 스타일시트 규칙을 읽지 못하게 막아서 토큰 목록이 빠질 수 있다.

토큰 찾아보기:

```bash
node scripts/manifest.mjs 배경 --layer 2   # 검색어(이름·설명·묶음, 모두 포함) + 층
node scripts/manifest.mjs --json          # 기계용
node scripts/manifest.mjs --tokens ../my-app/css/tokens.css accent   # 앱이 든 사본·번들 기준
```

`var()`를 끝까지 풀고 `light-dark()`는 테마별로 골라 보여 준다. 간격·라운드는 기본 밀도 기준 px도 붙인다.
`color-mix`는 식으로 남긴다. 밀도별·모션 최소화 덮어쓰기는 그 아래 줄에 선택자와 함께 나온다.
설명과 묶음은 CSS 주석에서 읽는다(줄 끝 주석 = 설명, `/* ---- 이름 ---- */` = 묶음). 그러니 새 토큰에도 주석을 달아 둔다.

## 에이전트(Claude Code) 스킬

`skill/SKILL.md`는 이 토큰을 쓰는 프로젝트에서 Claude가 따를 규칙이다. 담긴 내용은 이렇다.
어느 층을 쓰는지, margin 금지·라벨 줄 높이 같은 레이아웃 규칙, 처음 적용하는 순서, 토큰이 없을 때의 판단,
끝내기 전 `check.mjs` 검사. 규칙이 README에만 있으면 다른 저장소에서 일하는 에이전트는 읽지 않기 때문에 따로 두었다
(Meta Astryx가 스킬·`init`·manifest로 에이전트에게 규칙을 전하는 방식을 참고했다).

설치(사용자 전역, 모든 프로젝트에서 보임). 스킬을 고친 뒤에도 다시 복사한다:

```bash
mkdir -p ~/.claude/skills/design-tokens && cp skill/SKILL.md ~/.claude/skills/design-tokens/
```

스킬 안의 명령은 이 저장소 경로(`C:/workspace/design-tokens`)를 직접 가리킨다. 저장소를 옮기면 스킬의 경로도 고친다.

## 세 층과 규칙

| 층 | 이름 예 | 무엇 | 누가 쓰나 |
|----|---------|------|-----------|
| 1 원시값 | `--gray-22` `--blue-72` `--space-4` `--font-size-sm` | 팔레트와 스케일 | 2·3층만 |
| 2 역할 | `--color-bg-surface` `--color-fg-muted` `--font-body` `--gap-md` | "어디에 쓰는가" | **앱 코드** |
| 3 컴포넌트 | `--button-padding-y` `--panel-radius` `--chip-bg-selected` | 컴포넌트별 결정 | 컴포넌트 구현 |

규칙은 세 가지다. `node scripts/check.mjs`가 셋 다 검사한다.

1. **날 값은 1층에만 둔다.** 2·3층, `base.css`, `ui.css`에 `#hex`·`rgb()`·`12px` 같은 값이 있으면 실패한다.
2. **참조는 위층 방향으로만 한다.** 1층은 아무것도 참조하지 않고, 2층은 1층만, 3층은 1·2층만 참조한다.
3. **정의되지 않은 토큰은 쓰지 않는다.** CSS는 `var(--sapce-2)` 같은 오타를 조용히 무시하니 검사기가 잡는다.

앱 코드에서는 2층을 쓴다. 1층 **팔레트 색**(`--gray-22` 등)은 앱에서 쓰지 않는다. 테마가 바뀌어도 색이 따라 바뀌지 않기 때문이고,
`check.mjs`가 실패로 잡는다. 1층 **스케일**(`--space-*` `--radius-*` `--font-size-*`)은 맞는 2층 역할이 없을 때 앱에서 써도 된다.

## 체계 (값을 박지 않고 계산하는 부분)

- **간격**: `--space-N = --space-unit × N`. 이름의 숫자는 배수이고 px이 아니다(`_5`는 반 단계).
  단위 하나만 바꾸면 전체 밀도가 바뀐다.
- **라운드**: `--radius-* = --radius-unit × 배수`. `--radius-unit: 0`이면 전부 직각이 된다.
- **색 이름 = OKLCH 명도(%)**: `--gray-22`는 명도 22%다. 두 색의 숫자 차이가 대략 대비를 뜻한다
  (본문 텍스트는 ~45 이상). 새 단계는 그 명도 숫자로 끼워 넣으면 되고, 기존 이름은 바꾸지 않는다.
- **파생 색**: 새 hex를 만들지 않는다.
  - 옅은 배경 = 기준색 + 투명도 (`color-mix(… var(--alpha-subtle), transparent)`)
  - hover/press = 기준색을 전경색 쪽으로 `--mix-hover`/`--mix-press`만큼 섞는다.
    다크에서는 밝아지고 라이트에서는 어두워지므로 테마별 규칙이 따로 필요 없다.
  - 예외: 채움 위 글자(`--color-on-X`)가 늘 흰색인 `danger`는 두 테마 모두 검정 쪽으로 섞는다.
    원칙은 "on-색에서 멀어지는 쪽"이다. 그래야 상태가 바뀌어도 글자 대비가 줄지 않는다.
- **의도(intent) 색은 모두 같은 모양이다**: `accent` · `success` · `warning` · `danger` 각각
  `--color-X`(텍스트), `-solid`, `-solid-hover`, `-solid-press`, `--color-on-X`, `-subtle`, `-subtle-hover`, `-border`.
  - **글자와 채움은 단계가 다르다**(라이트). 채움(`-solid`)은 위에 올린 글자와 4.5:1이면 되지만,
    글자(`--color-X`)는 옅은 배경 위에서도 읽혀야 해서 더 어둡다.
  - **대비 약속**: `--color-X` 글자는 페이지·패널·움푹한 영역, 그리고 그 위에 깐 자기 `-subtle`·`-subtle-hover` 배경
    어디서나 4.5:1 이상이다. 채움 위 글자는 기본·hover·press 모두 4.5:1 이상이다.
- **테두리는 둘로 나뉜다**(WCAG 1.4.11 비텍스트 대비).
  - `--color-border-control`: 입력창·칩·테두리 버튼처럼 그 선이 있어야 컨트롤인 줄 아는 곳. 인접 배경과 3:1 이상.
  - `--color-border` · `-strong` · `-subtle`: 패널·구분선 같은 장식선. 대비 기준이 없다.
- **한 줄 컨트롤은 높이가 하나다**(`--control-height`: 기본 36 · 촘촘 31 · 여유 41px). 버튼·입력창·셀렉트·아이콘 버튼을
  나란히 놓아도 어긋나지 않는다. 행간이 다른 입력창은 위아래 여백을 이 높이에서 거꾸로 계산한다.
- **라벨 색은 뜻이 없는 분류용 텍스트 색이다**: `--color-label-{blue,red,purple,green,orange}`. 태그 종류처럼 무리만
  구분할 때 쓰고, 어느 색이 무엇인지는 앱 3층이 정한다(예: `--tag-artist: var(--color-label-red)`). 성공·오류를 뜻할 때는 의도 색을 쓴다.
- **타이포는 역할 묶음**: `font: var(--font-body)` 한 줄로 굵기·크기·행간·서체를 함께 지정한다.
- **모션**: `prefers-reduced-motion`이면 시간 토큰이 0이 되므로, 토큰을 쓰는 전환은 따로 처리하지 않아도 꺼진다.

## 레이아웃 규칙 (실제 화면에서 깨졌던 것에서 나온 규칙)

1. **컴포넌트는 바깥 여백(margin)을 갖지 않는다.** 간격은 부모가 정한다.
   - 쓰는 것: `gap`, `--field-gap`(필드↔필드), `--label-gap`(라벨 줄↔입력), `--action-gap`(필드 묶음↔동작 버튼)
   - 왜: anima에서 `button { margin-top }` 하나 때문에 버튼 24개가 여백을 물려받았다.
     그중 flex 행에 든 LoRA ×, 상단 생성 버튼, 칩이 혼자 아래로 처졌다.
2. **라벨 줄은 높이가 하나다(`--field-label-height`).** 글자만 있든, 체크박스·배지·작은 입력(`.input-sm`)이 있든 24px이다(촘촘 23 · 여유 25).
   - 이 높이는 작은 입력의 높이와 같은 식으로 계산한다. 간격 배수로 두면 촘촘한 밀도에서 작은 입력보다 낮아져 줄마다 높이가 달라진다.
   - 그래서 라벨 글자에서 아래 입력창까지 보이는 간격이 모든 필드에서 같다.
   - 라벨 줄 안의 입력은 `.input-sm`을 써서 그 높이에 맞춘다(12×1.5 + 2×2 + 2 = 24).
   - 왜: 긍정 프롬프트 줄(배지 22.5px)과 부정 프롬프트 줄(일반 입력 36px)의 높이가 달라서 간격이 2px와 13px로 갈렸다.
3. **셀렉트 화살표는 토큰으로 그린다.** 브라우저 기본 화살표는 `padding`을 무시하고 테두리에 붙기 때문이다.
   - `--select-chevron-*` 토큰과 그라디언트 두 개로 v를 그린다(이미지 없음).
   - v 오른쪽 여백은 입력창 좌우 여백과 같고, 색은 테마를 따른다.
   - 덤으로 셀렉트가 일반 입력과 높이가 같아진다(기본 셀렉트는 행간을 무시한다).

## 테마

- 기본은 다크이고, OS가 라이트 모드면 라이트로 바뀐다.
- `data-theme="light"` 또는 `"dark"`를 붙이면 OS 설정보다 우선한다.
- **어느 요소에든 붙일 수 있다.** 하위 트리만 다른 테마가 된다(스타일 가이드의 좌우 비교가 이 방식이다).
- 각 역할 토큰은 `light-dark(라이트, 다크)`로 한 줄에 정의되어 있어서, 라이트 블록을 두 번 쓰지 않는다.

```js
document.documentElement.dataset.theme = "light"; // 강제
delete document.documentElement.dataset.theme;    // OS 자동으로 복귀
```

### 테마 전환 버튼 (theme.js + ui.css `.theme-toggle`)

사용자가 고른 테마를 기억하고, 다음 방문 때 **첫 화면이 그려지기 전에** 적용한다.
CSS를 불러오기 전, `<head>`에 일반 스크립트로 둔다(모듈·`defer`·`async`면 그려진 뒤에 돌아서 한 번 깜빡인다).

```html
<head>
  <script src="/theme.js" data-key="my-app:theme"></script>  <!-- data-key = localStorage 키, 앱마다 다르게 -->
  <link rel="stylesheet" href="/design-tokens/tokens.css" />
  …
```

- 기억한 값(`light`·`dark`)이 있으면 `<html data-theme>`에 붙인다. 없으면 아무것도 붙이지 않으므로
  토큰 기본 동작(다크, OS가 라이트면 라이트)대로 가고, OS 설정이 바뀌면 바로 따라간다.
- localStorage가 막혀도(사생활 모드 등) 전환은 된다. 기억만 안 된다. 이상한 값이 들어 있으면 무시한다.
- API `window.colorTheme`:

  | | |
  |---|---|
  | `get()` | 지금 보이는 테마 `"light"` · `"dark"` (`data-theme`, 없으면 OS) |
  | `saved()` | 기억한 값, OS를 따르는 중이면 `null` |
  | `set(t)` | `t`로 바꾸고 기억 (`light`·`dark` 말고는 `TypeError`) |
  | `toggle()` | 반대로 바꾸고 기억, 바뀐 값을 돌려줌 |
  | `reset()` | 기억을 지우고 `data-theme`을 떼어 OS 따르기로 복귀 |
  | `key` | 쓰는 localStorage 키 |

  바뀔 때 `window`에 `themechange` 이벤트(`detail: { theme, saved }`)를 보낸다. `set`·`toggle`·`reset` 때,
  OS를 따르는 중에 OS 설정이 바뀔 때, 다른 탭에서 바꿨을 때(`storage` 이벤트) 온다.
  React 등에서는 이 이벤트를 듣고 `get()`으로 다시 그리면 된다.

버튼 마크업(프레임워크 없이). `data-theme-toggle`이 붙은 요소를 누르면 `toggle()`하고,
`aria-label`·`title`을 할 일로 맞춘다. 문구는 `data-label-to-light`·`data-label-to-dark`로 바꿀 수 있다.

```html
<button type="button" class="btn btn-ghost btn-sm theme-toggle" data-theme-toggle>
  <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
  </svg>
  <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z" />
  </svg>
</button>
```

- **아이콘은 "누르면 될 것"**이다. 지금 다크면 해, 라이트면 달. 버튼 이름도 상태가 아니라 할 일
  ("라이트 모드로 바꾸기")이다. 상태를 보이면 "달 = 지금 다크"인지 "달 = 다크로 가기"인지 헷갈린다.
- 해·달 SVG를 둘 다 넣어 두면 `ui.css`가 `:root`의 `data-theme`(없으면 OS 설정)을 보고 하나만 보인다.
  JS가 돌기 전에도, OS를 따르는 중에도 맞는 아이콘이 뜬다. 색은 `currentColor`라 버튼 글자색을 따른다.
- 크기는 `--theme-toggle-icon-size`(글자 스케일 `--font-size-lg`). 아이콘이 글자보다 큰 만큼 위아래 여백으로
  넘쳐 들어가게 해서(`--theme-toggle-icon-bleed`) 옆의 글자 `.btn-sm`과 높이가 같다(밀도 셋 모두 실측 확인).
- 프레임워크 컴포넌트로 만들 때도 같은 SVG 두 개와 클래스를 쓰고, 클릭에서 `colorTheme.toggle()`을 부르고,
  `themechange`를 듣고 `aria-label`을 다시 그린다. 그 경우 `data-theme-toggle`은 붙이지 않는다(두 번 토글된다).

**적용할 때 주의할 점**

- **CSP**: `Content-Security-Policy: default-src 'self'`(또는 `script-src`에 `'unsafe-inline'` 없음)면
  `<head>` 안 인라인 스크립트는 막힌다. 그래서 초기화 코드를 파일(`theme.js`)로 둔다.
- **번들러**: Vite 등은 `type="module"`이 아닌 `<script src>`를 묶지 않는다. `theme.js`는 정적 폴더
  (Vite는 `public/`)에 두고 `<script src="/theme.js">`로 부른다. 빌드하면 그대로 `dist/theme.js`로 나가고 태그도 남는다.
- **배포 뒤 확인**: `theme.js`는 번들 밖 정적 파일이라 배포물에서 빠져도 빌드가 실패하지 않는다.
  404여도 화면은 깨지지 않고 OS를 따르기만 해서 눈으로는 잘 안 보이니, 배포 뒤 `/theme.js`가 200인지 본다.
- **그림자 루트·편집기 위젯**: `color-scheme`과 커스텀 속성은 상속되고 상속은 그림자 루트 경계를 넘는다.
  그래서 웹 컴포넌트 안이나 CodeMirror 같은 편집기도 `<html data-theme>`만 바꾸면 스크롤바·네이티브 컨트롤까지
  같이 바뀐다. 위젯 자체 색은 토큰(`var(--color-*)`)으로 칠해 두면 따로 테마 코드를 둘 필요가 없다.

## 밀도

```html
<html data-density="compact">     <!-- 단위 3px -->
<section data-density="comfortable"> <!-- 단위 5px, 이 영역만 -->
```

간격이 들어간 2·3층 토큰은 `:root, [data-density]` 선택자로 정의되어 있어서 하위 트리에서도 다시 계산된다.
커스텀 속성은 선언된 요소에서 계산된 뒤 상속되기 때문에, 이렇게 하지 않으면
하위 요소에서 `--space-unit`만 바꿔도 `--space-4`는 바뀌지 않는다.

## 확장하는 법

- **색 추가**: OKLCH 명도를 재서 1층에 `--{hue}-{L}`로 넣고, 2층에서 역할에 연결한다.
  `check.mjs`가 아무 데서도 쓰지 않는 팔레트 색을 경고한다.
- **새 의도(예: info)**: 2층의 `success` 블록 8줄을 복사해서 이름만 바꾼다.
- **새 컴포넌트**: 3층에 `--{컴포넌트}-{속성}` 블록을 추가하고 2층 역할만 참조한다.
  CSS나 React 컴포넌트에서는 그 토큰만 쓴다.
- **변형(variant)**: `ui.css`의 `.btn`처럼 지역 변수(`--_bg` 등)만 바꾸고, 상태 규칙(hover·active·disabled)은
  한 곳에 둔다. 변형마다 상태 규칙을 반복하면 선택자 우선순위가 꼬인다.
- 바꾼 뒤에는 `node scripts/check.mjs`를 돌리고 스타일 가이드의 대비 표를 확인한다.

## webgpu 사이트 변수 → 새 토큰

| 사이트 (`app.css`) | 새 토큰 |
|---|---|
| `--bg` `#0f1115` | `--color-bg` |
| `--panel` `#181b22` | `--color-bg-surface` |
| `#11141a` (입력·로그·캔버스) | `--color-bg-sunken` |
| `#2a2e38` (보조 버튼) | `--color-bg-muted` |
| `#1a2030` (활성 칩·선택 항목) | `--color-bg-selected` |
| `#3a4154` / `#767e92` (비활성 버튼) | `--color-bg-disabled` / `--color-fg-disabled` |
| `--border` | `--color-border` |
| `--text` | `--color-fg` |
| `--dim` | `--color-fg-muted` |
| `--accent` | `--color-accent` (채움은 `--color-accent-solid`) |
| `#0b0e14` (accent 버튼 글자) | `--color-on-accent` |
| `--ok` / `--warn` / `--err` | `--color-success` / `--color-warning` / `--color-danger` |
| `#c0283c` (삭제 hover) | `--color-danger-solid` |
| `rgba(122,162,247,.12~.14)` | `--color-accent-subtle` |
| `rgba(122,162,247,.22)` / `.35` | `--color-accent-subtle-hover` / `--color-accent-border` |
| `rgba(0,0,0,.92)` (라이트박스) | `--color-scrim-media` |
| `14px/1.5 "Segoe UI"…` | `--font-body` |

## 결정 기록

검증된 사실에는 **(재확인 불필요)**를 붙였다.

- **기준값**: 사이트 `app.css`와 `index.html` 인라인 스타일의 실측 빈도로 스케일을 정했다.
  글자 크기는 12(23회) > 11(13) > 13(4) > 14 > 10 순이고, 간격은 2px 반 단계(6·10·14)가 자주 쓰인다.
  그래서 간격에 `_5` 반 단계를 두었다. **(재확인 불필요)**
- **F:\css와 다른 점**
  - 토큰이 한 층(평면)이던 것을 세 층으로 나눴다.
  - 라이트 테마가 두 블록에 중복되던 것을 `light-dark()` 한 줄로 바꿨다.
  - `--space-16` 같은 px 기반 이름을 배수 기반 이름으로 바꿨다(단위를 바꿔도 이름이 거짓말을 하지 않는다).
  - 반투명 틴트 hex를 `color-mix` 파생으로 바꿨다.
  - `prefers-reduced-motion`의 `!important` 일괄 처리를 시간 토큰 0으로 바꿨다.
- **라이트 경고색**: F:\css의 `#9a6a12`는 `#f7f8fa` 위에서 4.45:1이라 미달이고, 경고 배지(옅은 배경) 위에서는
  `#8f6211`도 4.43:1로 미달이었다. 그래서 `#8a5f10`(`--amber-52`)으로 바꿨고, 배지 위에서 4.62:1이 나온다. **(재확인 불필요)**
- **라이트 텍스트**: `#1a1d24`와 다크 패널 `#181b22`는 명도 차이가 1%도 안 나서 하나(`--gray-22`)로 합쳤다.
  라이트 mute(`#7b8290`)도 `#767e92`(`--gray-59`)로 합쳤다.
- **`--color-fg-subtle`**: 라이트에서 3.59:1이다. 플레이스홀더·비활성 전용이고 본문에는 쓰지 않는다.
- **대비 검사 결과**: 다크·라이트 180개 조합이 모두 기준을 통과한다(2026-11-11 기준, 아래 "대비·컨트롤 정비" 참고). 브라우저 실측값과 Node 사전 계산값
  (예: fg-muted on surface 5.46, accent on surface 6.84)이 일치해서, `light-dark()`가 하위 트리별로
  제대로 풀린다는 것도 같이 확인했다. **(재확인 불필요)**
- **밀도·테마 동작**: 밀도를 바꾸면 컴포넌트 토큰까지 다시 계산된다(버튼 세로 여백 10 → 7.5/12.5px).
  루트를 라이트로 강제해도 `data-theme="dark"` 하위 트리는 다크로 남는다. **(재확인 불필요)**
- **검사기 자체 검증**: 날 값, 미정의 참조(오타), 층 역참조를 일부러 넣은 사본에서 4건을 모두 잡고 exit 1로 끝났다. **(재확인 불필요)**
- **테마 전환(theme.js, 2026-11-09)**: 와카아카에서 먼저 만들고 검증한 것을 일반화했다. React 컴포넌트, 키 이름, 버튼 위치는 앱마다 다르므로 앱에 둔다.
  스타일 가이드(서버 5180)에서 확인했다. **(재확인 불필요)**
  - OS 다크, 기억 없음 → 다크·해·"라이트 모드로 바꾸기". 누르면 `data-theme=light`, 저장 `light`, 바탕 `#f7f8fa`, 달, 테마 칩도 따라감.
  - 새로 고침 뒤 유지. `reset()` 뒤 OS를 따름. OS 라이트로 바꾸면 기억 없을 때만 따라가고(이벤트 1회), 기억이 있으면 그대로.
  - 다른 탭에서 `set()`하면 `storage` 이벤트로 따라옴. 버튼 높이는 글자 `.btn-sm`과 같음(기본 26 · 촘촘 23 · 여유 29px).
  - 저장 막힘(접근 시 예외), 이상한 저장값, `data-key` 없음(키 `theme`), `set("blue")`(`TypeError`)는 DOM 흉내 낸 Node에서 확인.
  - 함정: 브라우저 창이 숨겨져(백그라운드) 화면을 그리지 않는 동안에는 `matchMedia` `change` 이벤트가 오지 않는다(이벤트는 렌더링 단계에서 나간다).
    CSS는 바로 바뀌는데 문구만 늦는 것처럼 보이니, 자동 검사에서는 한 프레임 그리게 한 뒤 확인한다.

- **토큰 찾아보기·스킬(2026-11-11)**: `manifest.mjs`의 해석값을 브라우저 계산값과 대조했다. **(재확인 불필요)**
  - 방법: 토큰마다 `var(--x)`를 넣은 요소와 manifest 해석값(리터럴)을 넣은 요소의 계산 스타일을 비교했다.
    비교 속성은 값이 유효한 첫 속성이다(background-color · width · box-shadow · font · transition · line-height 등).
    다크·라이트 하위 트리에서 각각 했다. 일부러 틀린 값을 넣으면 다르게 나오는 것도 확인했다.
  - 결과: 332개 × 2테마 = 664건 중 650건이 그대로 일치했다. 나머지 14건은 시간 토큰과 그걸 쓰는 전환 토큰이다.
    검사한 브라우저가 `prefers-reduced-motion: reduce`였고, manifest가 덮어쓰기로 보여 주는 `0ms`를 적용하면 14건 모두 일치했다.
    `px`로 표시한 값도 브라우저 계산 폭과 모두 같았다.
  - 1층에 `--mix-*`·`--space-unit` 묶음 머리 주석을 추가했다(주석만 바뀜, 값 변화 없음). 이전에는 `[서체]` 묶음으로 잘못 잡혔다.
  - 스킬의 명령(manifest 검색, check, 토큰 파일 찾기 grep)을 다른 폴더에서 실행해 확인했다.
    check는 날 색·날 시간·오타 토큰을 실패로, `37px`을 고유 치수로 잡았다(exit 1).

- **대비·컨트롤 정비(2026-11-11)**: 대비 표에 없던 조합과 밀도별 높이를 브라우저에서 재서 나온 문제를 고쳤다.
  기준은 WCAG 2.1 AA(글자 4.5:1, 컨트롤 경계·포커스 3:1)와 "같은 크기 단계의 컨트롤은 높이가 같다"는 관례다. **(재확인 불필요)**

  | 문제 (고치기 전 실측) | 고친 것 | 고친 뒤 실측 |
  |---|---|---|
  | 라이트: 의도 색 글자가 옅은 배경 위에서 미달. 최악은 움푹한 영역 위 `-subtle-hover`로 3.64~3.98 | 라이트 글자 단계 추가(`--blue-46` `--green-44` `--amber-46` `--red-45`). 채움과 라벨은 기존 단계 유지 | 9개 조합 × 4색 모두 4.60 이상 |
  | 다크: 삭제 버튼 press 4.21 (흰 글자인데 밝은 쪽으로 섞임) | `danger` hover·press를 검정 쪽으로 섞음 | 기본·hover·press 모두 통과 |
  | 다크: 기본 배지 `fg-muted` on `bg-muted` 4.30 | `--badge-fg`를 `--color-fg`로 (3층 토큰 추가) | 통과 |
  | 입력창·칩·테두리 버튼 경계 1.2~1.7 (3:1 미달) | `--color-border-control` 추가(`--gray-62` / `--gray-52`), 컨트롤 테두리에 적용 | 3.13~3.64 |
  | 버튼 36px vs 입력창·셀렉트 39px (세 밀도 모두 3~4px 차이) | `--control-height` 추가, 입력창 여백을 거꾸로 계산 | 36 · 촘촘 31 · 여유 41로 모두 같음. 버튼 높이는 그대로 |
  | 촘촘한 밀도에서 라벨 줄 18 / 19 / 19.5 / 23px | `--field-label-height`를 작은 입력과 같은 식으로 | 24 · 촘촘 23 · 여유 25, 내용과 무관하게 같음 |
  | `.input:focus-visible`이 `outline: none` | 투명 outline으로 (고대비 모드에서 포커스 표시 유지) | 코드로만 확인. 고대비 모드에서 재 보지는 않았다 |

  - 대비 표를 88 → 180개 조합으로 넓혔다. 의도 색 글자는 세 바탕 × (그대로·subtle·subtle-hover), 채움 위 글자는
    기본·hover·press, 컨트롤 경계와 포커스 링은 세 바탕 위 3:1을 본다. 가장 낮은 값은 다크 `danger` on `danger-subtle-hover` / 패널 4.54다.
  - 새 색 단계는 기존 색의 색상·채도를 유지하고 OKLCH 명도만 낮춰서 구했다(sRGB 밖이면 채도를 줄임).
    목표는 최악 조합에서 4.6 이상이 되는 가장 밝은 값이다.
  - 라벨 색은 그대로 두었다. 다섯 색의 명도를 맞춘 한 벌이라, 파랑·빨강·초록만 어두워지면 고르지 않게 된다.
  - **이 변경을 앱에 가져가면 달라지는 것**: 라이트의 의도 색 글자·링크·포커스 링이 조금 어두워진다. 입력창·셀렉트 높이가 3px 줄고(39 → 36),
    입력창·칩·테두리 버튼·아이콘 버튼의 테두리가 또렷해진다. 기본 배지 글자가 밝아진다. 다크에서 삭제 버튼 hover·press가 어두워지는 쪽으로 바뀐다.
- **검사기 보강(2026-11-11)**: **(재확인 불필요)**
  - `--tokens <폴더|번들>`: 앱이 든 사본 기준으로 검사·조회한다. 원본 기준으로는 anima 번들에 없는 `--color-label-red`가 통과했는데,
    번들 기준으로는 미정의 참조로 잡힌다. wakaaka 폴더 사본·anima 번들 기준으로 두 앱의 실제 CSS가 실패 0인 것도 확인했다.
  - 색 이름과 실제 OKLCH 명도가 1.5 넘게 다르면 실패. 팔레트 색은 이름 모양(`--{hue}-{L}`)으로 찾는다.
    전에는 색상 이름을 나열해서 보라·주황의 미사용 경고가 빠져 있었다.
  - 앱 코드의 1층 팔레트 색 참조는 실패. HTML의 작은따옴표 `style=''`도 검사한다.
  - 일부러 틀린 사본(이름과 다른 명도, 안 쓰는 새 색, 앱의 `var(--gray-22)`, 작은따옴표 속 hex)으로 각 규칙이 잡는 것을 확인했다.

## 적용 사례: anima-webgpu-next (2026-11-03)

`web/css/tokens.css`(번들)와 `app.css`로 적용했다. 순서는 이랬다.

1. **기준선 캡처**: 요소별 계산 스타일·위치와 규칙별 해석값을 캡처했다.
2. **A. 정확히 같은 값만 토큰으로 교체**: 차이 0을 확인했다(color-scheme과 대체 글꼴 목록만 예외).
3. **B. 스케일 밖 값을 스케일에 맞춤**: 바꾼 곳만 달라졌는지 확인했다.
4. **C. 인라인 스타일을 클래스로 옮김**: 같은 방식으로 확인했다.

자세한 기록은 그 저장소의 `WORKLOG.md` "디자인 토큰 적용" 절에 있다. 다른 프로젝트에 옮길 때 참고할 점:

- 기존 사이트가 다크 전용이면 `<html data-theme="dark">`로 고정한다. 안 그러면 OS 라이트 사용자에게 갑자기 라이트가 뜬다.
- JS가 `el.style.display = ""`로 보이게 하는 요소는 `display: none`을 클래스로 옮기면 안 된다.
- 토큰 도입은 `color-scheme`을 켜므로 체크박스·스크롤바 같은 네이티브 컨트롤 모양이 바뀐다. `accent-color`도 같이 정해 둔다.

## 브라우저 지원

`light-dark()`(Chrome 123 · Firefox 120 · Safari 17.5)와 `color-mix()`(Chrome 111 · Firefox 113 · Safari 16.2)가 필요하다.
2024년 이후 에버그린 브라우저는 모두 지원한다.

## 참고: 미디어 쿼리 브레이크포인트

CSS 변수는 `@media` 조건 안에서 쓸 수 없어서 토큰으로 두지 않았다. 사이트 기준값은 다음과 같다.

- `900px`: 2단 → 1단 (사이드바 레이아웃)
- `640px`: 좁은 단일 페이지 최대 폭(`--layout-max-width-narrow`)
