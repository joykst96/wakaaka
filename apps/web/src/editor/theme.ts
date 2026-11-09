// CodeMirror 테마. 편집기는 그림자 루트 안에 있어서 앱 CSS가 닿지 않는다(DESIGN 10절). 모양은 여기서만 정하고,
// 값은 모두 토큰(2층·앱 3층)이다. 사용자 정의 속성은 그림자 경계를 넘어 상속되므로 테마·밀도가 그대로 따라온다.

import { EditorView } from "@codemirror/view";

export const wakaakaTheme = EditorView.theme({
  "&": {
    background: "var(--editor-bg)",
    color: "var(--editor-fg)",
    border: "var(--wk-border-width) solid var(--editor-border)",
    borderRadius: "var(--editor-radius)",
  },
  "&.cm-focused": { outline: "none", borderColor: "var(--editor-border-focus)" },
  ".cm-content": { font: "var(--editor-font)", padding: "var(--editor-padding)", caretColor: "var(--editor-caret)" },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { font: "var(--editor-font)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { background: "var(--editor-selection)" },
  ".cm-cursor": { borderLeftColor: "var(--editor-caret)" },
  ".cm-placeholder": { color: "var(--color-fg-subtle)" },
  ".cm-gutters": { background: "var(--editor-bg)", color: "var(--editor-gutter-fg)", border: "none" },

  // 구문
  ".wk-d1": { color: "var(--editor-choice-1)" },
  ".wk-d2": { color: "var(--editor-choice-2)" },
  ".wk-d3": { color: "var(--editor-choice-3)" },
  ".wk-foreign": { color: "var(--editor-foreign)" },
  ".wk-weight": { color: "var(--editor-weight)" },
  ".wk-escape": { color: "var(--editor-escape)" },
  ".wk-comment": { color: "var(--editor-comment)", fontStyle: "var(--editor-comment-font-style)" },
  ".wk-nameref": { color: "var(--editor-name-ref)" },

  // 참조 칩
  ".wk-chip": {
    display: "inline-block",
    padding: "0 var(--ref-chip-padding-x)",
    border: "var(--wk-border-width) solid var(--ref-chip-border)",
    borderRadius: "var(--ref-chip-radius)",
    background: "var(--ref-chip-bg)",
    color: "var(--ref-chip-fg)",
    font: "var(--ref-chip-font)",
    cursor: "pointer",
  },
  ".wk-chip:hover": { background: "var(--ref-chip-bg-hover)" },
  ".wk-chip-missing": { background: "var(--ref-chip-missing-bg)", color: "var(--ref-chip-missing-fg)", borderColor: "var(--ref-chip-missing-fg)" },
  ".wk-chip-origin": { color: "var(--ref-chip-origin-fg)" },

  // 오류 밑줄 (lint)
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--editor-error-underline)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--editor-warning-underline)" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted var(--editor-info-underline)" },
  ".cm-tooltip": {
    background: "var(--editor-tooltip-bg)",
    color: "var(--editor-fg)",
    border: "var(--wk-border-width) solid var(--editor-tooltip-border)",
    borderRadius: "var(--wk-radius)",
    boxShadow: "var(--editor-tooltip-shadow)",
    font: "var(--font-body-sm)",
  },
  ".cm-tooltip-lint, .wk-peek": { padding: "var(--editor-tooltip-padding)" },
  ".cm-diagnostic": { padding: "0", border: "none" },
  ".cm-diagnostic-error": { color: "var(--color-danger)" },
  ".cm-diagnostic-info": { color: "var(--color-fg-muted)" },

  // 자동완성
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { font: "var(--font-body-sm)", maxHeight: "var(--editor-completion-max-height)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "var(--editor-completion-item-padding)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "var(--editor-completion-active)", color: "var(--editor-fg)" },
  ".cm-completionDetail": { color: "var(--editor-completion-detail)", fontStyle: "normal", marginLeft: "var(--editor-completion-detail-gap)" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--color-accent)" },

  // 참조 후보의 고정 배지: 앱의 .fixed-badge와 같은 토큰(사용자 정의 속성은 그림자 경계를 넘어 상속된다)
  ".wk-fixed-badge": {
    display: "inline-grid",
    placeItems: "center",
    verticalAlign: "middle",
    width: "var(--fixed-badge-size)",
    height: "var(--fixed-badge-size)",
    marginRight: "var(--editor-completion-detail-gap)",
    borderRadius: "var(--fixed-badge-radius)",
    background: "var(--fixed-badge-bg)",
    color: "var(--fixed-badge-fg)",
    font: "var(--fixed-badge-font)",
    fontWeight: "bolder",
  },
  ".wk-fixed-space": { background: "none" },

  // 태그 후보: 이름은 분류 색, 뒤에 포스트 수와 한국어 설명 한 줄. 선택하면 옆에 설명 상자
  ".wk-tag-0 .cm-completionLabel, .wk-tag-info-title.wk-tag-0": { color: "var(--tag-general)" },
  ".wk-tag-1 .cm-completionLabel, .wk-tag-info-title.wk-tag-1": { color: "var(--tag-artist)" },
  ".wk-tag-3 .cm-completionLabel, .wk-tag-info-title.wk-tag-3": { color: "var(--tag-copyright)" },
  ".wk-tag-4 .cm-completionLabel, .wk-tag-info-title.wk-tag-4": { color: "var(--tag-character)" },
  ".wk-tag-5 .cm-completionLabel, .wk-tag-info-title.wk-tag-5": { color: "var(--tag-meta)" },
  ".wk-tag-summary": {
    display: "inline-block",
    maxWidth: "var(--editor-completion-summary-max-width)",
    marginLeft: "var(--editor-completion-detail-gap)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "bottom",
    color: "var(--editor-completion-summary)",
  },
  ".cm-tooltip.cm-completionInfo": { padding: "var(--editor-tooltip-padding)", maxWidth: "var(--editor-tag-info-max-width)" },
  ".wk-tag-info-title": { font: "var(--font-label)" },
  ".wk-tag-info-sub": { color: "var(--color-fg-muted)" },

  // 칩 미리보기 (hover)
  ".wk-peek-title": { font: "var(--font-label)", color: "var(--editor-fg)" },
  ".wk-peek-sub": { color: "var(--color-fg-muted)" },
  ".wk-peek-example": { font: "var(--font-code)", color: "var(--editor-fg)", whiteSpace: "pre-wrap" },
});
