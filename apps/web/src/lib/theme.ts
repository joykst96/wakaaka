// 테마 전환 (DESIGN 10절 "테마 전환 버튼"). 기억한 값(localStorage)이 있으면 그것, 없으면 OS를 따른다.
// 첫 화면 전 적용은 public/theme.js가 같은 규칙으로 한다.

import type { KeyValueStore } from "./drafts.ts";

export type Theme = "light" | "dark";
export const THEME_KEY = "wakaaka:theme";

function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 기억한 테마. 없거나 이상한 값이면 null(OS를 따른다) */
export function loadTheme(s: KeyValueStore | null = store()): Theme | null {
  try {
    const v = s?.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function saveTheme(t: Theme, s: KeyValueStore | null = store()): void {
  try {
    s?.setItem(THEME_KEY, t);
  } catch {
    // 저장이 막혀도 지금 화면은 바뀐다
  }
}

/** 지금 보이는 테마: 기억한 값, 없으면 OS 설정. 토큰 기본값은 다크라 OS가 라이트일 때만 라이트 */
export function effectiveTheme(saved: Theme | null, osLight: boolean): Theme {
  return saved ?? (osLight ? "light" : "dark");
}

export const nextTheme = (t: Theme): Theme => (t === "dark" ? "light" : "dark");
