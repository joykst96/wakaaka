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
  style-guide.html         눈으로 보는 카탈로그 + 대비 자동 검사
  scripts/check.mjs        규칙 검사 (날 값·참조 방향·오타) — 앱 CSS/HTML도 검사 가능
  scripts/bundle.mjs       3층을 파일 하나로 합치기 (배포용)
  scripts/serve.mjs        스타일 가이드 미리보기 서버
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

색·시간 리터럴과 정의되지 않은 토큰은 실패로 처리하고, 길이 리터럴은 "고유 치수" 목록으로 보여 준다.
그 화면에만 있는 치수(라이트박스 버튼 크기 등)는 토큰이 아니어도 되지만, 목록으로 드러나게 한다.

스타일 가이드 보기:

```bash
node scripts/serve.mjs
```

브라우저에서 `http://localhost:5180/`을 연다. `file://`로 직접 열어도 화면은 나오지만,
일부 브라우저는 로컬 파일의 스타일시트 규칙을 읽지 못하게 막아서 토큰 목록이 빠질 수 있다.

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

앱 코드에서는 2층을 쓴다. 1층을 직접 쓰면 테마가 바뀌어도 색이 따라 바뀌지 않는다.

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
- **의도(intent) 색은 모두 같은 모양이다**: `accent` · `success` · `warning` · `danger` 각각
  `--color-X`(텍스트), `-solid`, `-solid-hover`, `-solid-press`, `--color-on-X`, `-subtle`, `-subtle-hover`, `-border`.
- **라벨 색은 뜻이 없는 분류용 텍스트 색이다**: `--color-label-{blue,red,purple,green,orange}`. 태그 종류처럼 무리만
  구분할 때 쓰고, 어느 색이 무엇인지는 앱 3층이 정한다(예: `--tag-artist: var(--color-label-red)`). 성공·오류를 뜻할 때는 의도 색을 쓴다.
- **타이포는 역할 묶음**: `font: var(--font-body)` 한 줄로 굵기·크기·행간·서체를 함께 지정한다.
- **모션**: `prefers-reduced-motion`이면 시간 토큰이 0이 되므로, 토큰을 쓰는 전환은 따로 처리하지 않아도 꺼진다.

## 레이아웃 규칙 (실제 화면에서 깨졌던 것에서 나온 규칙)

1. **컴포넌트는 바깥 여백(margin)을 갖지 않는다.** 간격은 부모가 정한다.
   - 쓰는 것: `gap`, `--field-gap`(필드↔필드), `--label-gap`(라벨 줄↔입력), `--action-gap`(필드 묶음↔동작 버튼)
   - 왜: anima에서 `button { margin-top }` 하나 때문에 버튼 24개가 여백을 물려받았다.
     그중 flex 행에 든 LoRA ×, 상단 생성 버튼, 칩이 혼자 아래로 처졌다.
2. **라벨 줄은 높이가 하나다(`--field-label-height`).** 글자만 있든, 체크박스·배지·작은 입력(`.input-sm`)이 있든 24px이다.
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
- **대비 검사 결과**: 다크·라이트 58개 조합이 모두 기준을 통과한다. 브라우저 실측값과 Node 사전 계산값
  (예: fg-muted on surface 5.46, accent on surface 6.84)이 일치해서, `light-dark()`가 하위 트리별로
  제대로 풀린다는 것도 같이 확인했다. **(재확인 불필요)**
- **밀도·테마 동작**: 밀도를 바꾸면 컴포넌트 토큰까지 다시 계산된다(버튼 세로 여백 10 → 7.5/12.5px).
  루트를 라이트로 강제해도 `data-theme="dark"` 하위 트리는 다크로 남는다. **(재확인 불필요)**
- **검사기 자체 검증**: 날 값, 미정의 참조(오타), 층 역참조를 일부러 넣은 사본에서 4건을 모두 잡고 exit 1로 끝났다. **(재확인 불필요)**

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
