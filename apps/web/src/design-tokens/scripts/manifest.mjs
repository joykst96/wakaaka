// 토큰 찾아보기 (의존성 없음): 세 층의 토큰을 이름·층·라이트/다크 해석값·설명으로 보여 준다.
// 에이전트와 사람이 CSS 세 파일을 다 읽지 않고 맞는 토큰을 고르게 하려는 것이다.
//
//   node scripts/manifest.mjs                     전부 (한 줄에 하나)
//   node scripts/manifest.mjs 배경 danger         검색어가 모두 들어간 것만 (이름·설명·묶음, 대소문자 무시)
//   node scripts/manifest.mjs --layer 2           2층만 (앱 코드가 쓰는 층)
//   node scripts/manifest.mjs --json              JSON (검색어·--layer와 함께 쓸 수 있음)
//   node scripts/manifest.mjs --tokens <폴더|번들 파일> …   이 저장소 대신 프로젝트가 든 토큰을 본다 (source.mjs 참고)
//
// 해석값: var()를 끝까지 따라가 풀고, light-dark()는 테마별로 고른다. 간격·라운드의 calc는 기본 밀도(단위 4px),
// 루트 글자 16px 기준 px로 계산해 덧붙인다. color-mix는 브라우저가 섞으므로 식으로 남긴다.
// 덮어쓰기(밀도별 --space-unit, 모션 최소화 때 시간 0 등)는 overrides에 선택자와 함께 적는다.
import { loadTokens, takeTokensArg } from "./source.mjs";

let source, args;
try {
  const { tokens: tokensPath, rest } = takeTokensArg(process.argv.slice(2));
  source = loadTokens(tokensPath);
  args = rest;
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const DEFAULT_SELECTORS = new Set([":root", ":root,[data-density]"]);

// 주석을 같은 길이의 공백으로 바꿔 위치를 유지한다 (줄 끝 주석을 원문에서 다시 찾기 위해).
const blankComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

// 위치 i를 감싸는 블록들의 선택자 (바깥 → 안쪽)
function contextAt(css, i) {
  const stack = [];
  let start = 0;
  for (let j = 0; j < i; j++) {
    const ch = css[j];
    if (ch === "{") { stack.push(css.slice(start, j).trim().replace(/\s+/g, "")); start = j + 1; }
    else if (ch === "}") { stack.pop(); start = j + 1; }
    else if (ch === ";") start = j + 1;
  }
  return stack;
}

const tokens = new Map(); // 이름 → { name, layer, file, line, group, desc, value, overrides[] }
for (const { path: file, layer, raw } of source.layers) {
  const css = blankComments(raw);
  const headers = [...raw.matchAll(/\/\*\s*-{3,}\s*(.+?)\s*-{3,}/g)].map((m) => [m.index, m[1]]);
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*);/g)) {
    const [, name, rawValue] = m;
    const value = rawValue.replace(/\s+/g, " ").trim();
    const end = m.index + m[0].length;
    const lineEnd = raw.indexOf("\n", end);
    const tail = raw.slice(end, lineEnd === -1 ? undefined : lineEnd);
    const desc = tail.match(/^\s*\/\*\s*(.*?)\s*\*\//)?.[1] ?? "";
    const group = headers.filter(([at]) => at < m.index).at(-1)?.[1] ?? "";
    const ctx = contextAt(css, m.index);
    const line = raw.slice(0, m.index).split("\n").length;
    const isDefault = ctx.length === 1 && DEFAULT_SELECTORS.has(ctx[0]);
    if (!tokens.has(name)) tokens.set(name, { name, layer, file, line, group, desc, value: null, overrides: [] });
    const t = tokens.get(name);
    if (isDefault && t.value === null) Object.assign(t, { value, line, group, desc: desc || t.desc });
    else t.overrides.push({ when: ctx.join(" "), value });
  }
}

// 괄호 짝을 맞춰 함수 인자를 최상위 쉼표로 나눈다.
function callAt(s, at, fnLen) {
  let depth = 0, args = [], from = at + fnLen;
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth === 0) { args.push(s.slice(from, j).trim()); return { args, end: j + 1 }; } depth--; }
    else if (ch === "," && depth === 0) { args.push(s.slice(from, j).trim()); from = j + 1; }
  }
  throw new Error(`괄호 짝이 맞지 않음: ${s}`);
}

function resolve(value, mode, seen = new Set()) {
  let out = value;
  // var() → 정의값 (순환 방지)
  for (let guard = 0; /var\(/.test(out); guard++) {
    if (guard > 50) throw new Error(`var() 해석이 끝나지 않음: ${value}`);
    const at = out.indexOf("var(");
    const { args, end } = callAt(out, at, 4);
    const ref = tokens.get(args[0]);
    let sub;
    if (ref && ref.value !== null && !seen.has(args[0])) sub = resolve(ref.value, mode, new Set([...seen, args[0]]));
    else sub = args[1] ?? `var(${args[0]})`; // 정의 없으면 대체값, 그것도 없으면 그대로
    out = out.slice(0, at) + sub + out.slice(end);
  }
  // light-dark(라이트, 다크) → 테마별로 고르기
  for (let at; (at = out.indexOf("light-dark(")) !== -1; ) {
    const { args, end } = callAt(out, at, "light-dark(".length);
    out = out.slice(0, at) + (mode === "light" ? args[0] : args[1]) + out.slice(end);
  }
  return out;
}

// 길이 하나로 떨어지는 calc를 px로 계산한다 (rem = 16px). 안 되면 null.
function toPx(expr) {
  const js = expr
    .replace(/calc\(/g, "(")
    .replace(/(-?\d*\.?\d+)(rem|px)\b/g, (_, n, u) => `(${u === "rem" ? n * 16 : n})`);
  if (!/^[\d\s.()+\-*/]+$/.test(js)) return null;
  try { const v = Function(`"use strict"; return (${js});`)(); return Number.isFinite(v) ? +v.toFixed(3) : null; }
  catch { return null; }
}

const list = [...tokens.values()].map((t) => {
  const light = t.value === null ? null : resolve(t.value, "light");
  const dark = t.value === null ? null : resolve(t.value, "dark");
  // 단위 있는 길이만 (700 같은 굵기·z-index는 px가 아니다). 여러 값(그림자 "0 4px 12px")은 toPx가 null을 낸다.
  const px = light !== null && light === dark && /\d(rem|px)\b/.test(light) ? toPx(light) : null;
  return { ...t, light, dark, px };
});

// ---- 출력 ----
const json = args.includes("--json");
const li = args.indexOf("--layer");
const layer = li !== -1 ? +args[li + 1] : null;
const terms = args.filter((a, i) => !a.startsWith("--") && !(li !== -1 && i === li + 1)).map((a) => a.toLowerCase());
const hits = list.filter(
  (t) => (layer === null || t.layer === layer) && terms.every((q) => `${t.name} ${t.desc} ${t.group}`.toLowerCase().includes(q)),
);

if (json) {
  console.log(JSON.stringify(hits.map(({ name, layer, file, line, group, desc, value, light, dark, px, overrides }) =>
    ({ name, layer, file: `${file}:${line}`, group, desc, value, light, dark, ...(px !== null && { px }), ...(overrides.length && { overrides }) })), null, 2));
} else {
  for (const t of hits) {
    const v = t.light === t.dark ? t.light : `라이트 ${t.light} | 다크 ${t.dark}`;
    const extra = [t.px !== null && `= ${t.px}px`, t.desc && `— ${t.desc}`, t.group && `[${t.group}]`].filter(Boolean).join(" ");
    console.log(`${t.layer}층 ${t.name}: ${v}${extra ? "  " + extra : ""}`);
    for (const o of t.overrides) console.log(`      └ ${o.when}: ${o.value}`);
  }
  console.log(`\n${hits.length}개 (전체 ${list.length}개) · 기준 토큰: ${source.label}`);
}
