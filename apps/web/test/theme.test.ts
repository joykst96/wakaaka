// 테마 전환 (DESIGN 10절 "테마 전환 버튼"): 기억한 값 읽고 쓰기, 지금 테마 계산.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { effectiveTheme, loadTheme, nextTheme, saveTheme, THEME_KEY } from "../src/lib/theme.ts";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("테마", () => {
  test("기억한 값이 없으면 OS를 따른다", () => {
    expect(effectiveTheme(null, true)).toBe("light");
    expect(effectiveTheme(null, false)).toBe("dark");
  });
  test("기억한 값이 OS보다 앞선다", () => {
    expect(effectiveTheme("dark", true)).toBe("dark");
    expect(effectiveTheme("light", false)).toBe("light");
  });
  test("저장하고 읽기, 이상한 값은 무시", () => {
    const s = mem();
    expect(loadTheme(s)).toBeNull();
    saveTheme("light", s);
    expect(s.m.get(THEME_KEY)).toBe("light");
    expect(loadTheme(s)).toBe("light");
    s.setItem(THEME_KEY, "blue");
    expect(loadTheme(s)).toBeNull();
    expect(loadTheme(null)).toBeNull();
  });
  test("저장이 막혀도 던지지 않는다", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => {} };
    expect(loadTheme(broken)).toBeNull();
    expect(() => saveTheme("dark", broken)).not.toThrow();
  });
  test("전환", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });
  test("첫 화면 스크립트(public/theme.js)가 같은 키를 쓴다", () => {
    const js = readFileSync(new URL("../public/theme.js", import.meta.url), "utf8");
    expect(js).toContain(JSON.stringify(THEME_KEY));
  });
});
