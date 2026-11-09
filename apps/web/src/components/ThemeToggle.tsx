// 머리줄 맨 오른쪽 테마 전환 버튼 (DESIGN 10절 "테마 전환 버튼").
// 지금 다크면 해(누르면 라이트), 라이트면 달(누르면 다크). 기억한 값이 없으면 OS 설정이 바뀔 때 따라간다.

import { useEffect, useState } from "react";
import { effectiveTheme, loadTheme, nextTheme, saveTheme, type Theme } from "../lib/theme.ts";

const LIGHT_QUERY = "(prefers-color-scheme: light)";
const osLight = () => globalThis.matchMedia?.(LIGHT_QUERY).matches ?? false;

export function ThemeToggle() {
  const [saved, setSaved] = useState<Theme | null>(() => loadTheme());
  const [os, setOs] = useState(osLight);
  const theme = effectiveTheme(saved, os);

  useEffect(() => {
    const mq = globalThis.matchMedia?.(LIGHT_QUERY);
    if (!mq) return;
    const on = () => setOs(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const toggle = () => {
    const t = nextTheme(theme);
    document.documentElement.dataset.theme = t;
    saveTheme(t);
    setSaved(t);
  };

  const label = theme === "dark" ? "라이트 모드로 바꾸기" : "다크 모드로 바꾸기";
  return (
    <button type="button" className="btn btn-ghost btn-sm theme-toggle" onClick={toggle} title={label} aria-label={label}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z" />
    </svg>
  );
}
