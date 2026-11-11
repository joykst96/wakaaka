// 토큰 규칙 검사 (의존성 없음): node scripts/check.mjs [--tokens <폴더|번들 파일>] [앱 파일(.css/.html) ...]
//  1) 날 값 금지   — 1층 밖(2·3층, base.css, ui.css)에 hex/rgb/길이·시간 리터럴이 있으면 실패
//  2) 참조 방향   — 1층은 다른 층을, 2층은 3층을 참조하면 실패 (아래층만 위층을 본다)
//  3) 미정의 참조 — var(--x)의 --x가 어디에도 정의돼 있지 않으면 실패 (CSS는 오타를 조용히 무시한다)
//  4) 색 이름 = 명도 — 팔레트 색 --{hue}-{L}의 L이 실제 OKLCH 명도(%)와 1.5 넘게 다르면 실패
//  5) 미사용 팔레트 — 어디서도 안 쓰는 1층 색·투명도 토큰은 경고만
//     (간격·라운드·글자 크기 같은 스케일은 앱이 쓰라고 둔 것이라 검사하지 않는다)
//  앱 파일을 넘기면 그 파일도 검사한다 (.html은 <style>과 style 속성만):
//     색·시간 리터럴과 미정의 참조는 실패, 길이 리터럴은 "고유 치수"로 목록만 보여 준다
//     (라이트박스 버튼 크기처럼 그 화면에만 있는 치수는 토큰이 아니어도 된다 — 대신 눈에 보이게).
//     1층 팔레트 색(--gray-22 등)을 직접 참조해도 실패다. 테마가 바뀌어도 따라 바뀌지 않기 때문이다.
//     @media 조건은 var()를 쓸 수 없으므로 제외한다.
//  --tokens: 이 저장소 대신 프로젝트가 든 토큰(폴더 사본이나 번들)을 기준으로 삼는다. source.mjs 참고.
//  잡지 못하는 것: white·black 같은 색 이름, 굵기·행간·z-index·opacity 숫자, JS 객체의 숫자 값(padding: 12).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadTokens, takeTokensArg } from "./source.mjs";

let source, appArgs;
try {
  const { tokens, rest } = takeTokensArg(process.argv.slice(2));
  source = loadTokens(tokens);
  appArgs = rest;
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""));
const files = [...source.layers, ...source.extras].map((f) => ({ path: f.path, layer: f.layer, css: stripComments(f.raw) }));

// 앱 파일: 5층. HTML이면 <style> 블록과 style 속성만 뽑는다 (줄 번호 유지를 위해 나머지는 빈 줄로).
const APP = 5;
const STYLE_PARTS = /<style[^>]*>([\s\S]*?)<\/style>|style="([^"]*)"|style='([^']*)'/g;
for (const arg of appArgs) {
  let text = readFileSync(resolve(arg), "utf8");
  if (arg.endsWith(".html")) {
    let out = "", at = 0;
    for (const m of text.matchAll(STYLE_PARTS)) {
      out += text.slice(at, m.index).replace(/[^\n]/g, "") + (m[1] ?? `x{${m[2] ?? m[3]}}`);
      at = m.index + m[0].length;
    }
    text = out + text.slice(at).replace(/[^\n]/g, "");
  }
  // @media 조건은 var()를 못 쓰므로 조건 부분만 지운다
  files.push({ path: arg, layer: APP, css: stripComments(text).replace(/@media[^{]*/g, (s) => s.replace(/[^\n]/g, " ")) });
}

const definedIn = new Map(); // 토큰 → 정의된 층
const paletteColors = new Map(); // 1층 팔레트 색 --{hue}-{L} → { hex, at }
for (const f of files)
  for (const m of f.css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)/g)) {
    const [, name, value] = m;
    if (!definedIn.has(name)) definedIn.set(name, f.layer);
    if (f.layer === 1 && /^--[a-z]+-\d+$/.test(name) && /^#[0-9a-f]{6}$/i.test(value.trim()))
      paletteColors.set(name, { hex: value.trim(), at: `${f.path}:${f.css.slice(0, m.index).split("\n").length}` });
  }

const errors = [];
const warnings = [];
const appDims = [];
const used = new Set();
const lineOf = (css, index) => css.slice(0, index).split("\n").length;

for (const f of files) {
  // 2·3) 참조 검사
  for (const m of f.css.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = m[1];
    used.add(name);
    const at = `${f.path}:${lineOf(f.css, m.index)}`;
    if (!definedIn.has(name)) errors.push(`미정의 참조 ${name}  (${at})`);
    else if (definedIn.get(name) > f.layer) errors.push(`참조 방향 위반: ${f.layer}층이 ${definedIn.get(name)}층 토큰 ${name}를 참조  (${at})`);
    else if (f.layer === APP && paletteColors.has(name)) errors.push(`앱 코드가 1층 팔레트 색 ${name}를 직접 참조 — 2층 역할 토큰을 쓴다  (${at})`);
  }
  // 1) 날 값 검사 (1층 제외)
  if (f.layer === 1) continue;
  const raw = [
    /#[0-9a-fA-F]{3,8}\b/g,
    /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g,
    /(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s|vh|vw|%)(?![\w-])/g,
  ];
  const allowed = new Set(["100%", "50%", "100vw"]); // 레이아웃·기하 의미의 상대값 (50% = 가운데)
  for (const re of raw)
    for (const m of f.css.matchAll(re)) {
      if (allowed.has(m[0])) continue;
      const at = `${f.path}:${lineOf(f.css, m.index)}`;
      if (f.layer < APP) errors.push(`날 값 "${m[0]}"  (${at})`);
      else if (/(?:%|vh|vw)$/.test(m[0])) continue; // 앱의 상대 단위는 배치 의미라 허용
      else if (/(?:px|rem|em)$/.test(m[0])) appDims.push(`"${m[0]}"  (${at})`);
      else errors.push(`날 값 "${m[0]}"  (${at})`);
    }
}

// 4) 색 이름 = OKLCH 명도
const oklchL = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
};
for (const [name, { hex, at }] of paletteColors) {
  const claimed = +name.match(/\d+$/)[0];
  const actual = oklchL(hex);
  if (Math.abs(actual - claimed) > 1.5) errors.push(`색 이름과 명도가 다름: ${name}는 ${hex}, 실제 명도 ${actual.toFixed(1)}  (${at})`);
}

// 5) 미사용 팔레트
for (const [name, layer] of definedIn)
  if (layer === 1 && (paletteColors.has(name) || /^--(?:alpha|mix)-/.test(name)) && !used.has(name)) warnings.push(`미사용 팔레트 ${name}`);

for (const d of appDims) console.log("고유 치수  " + d);
for (const w of warnings) console.log("경고  " + w);
for (const e of errors) console.log("실패  " + e);
console.log(`\n기준 토큰: ${source.label}`);
console.log(`토큰 ${definedIn.size}개 · 참조 ${used.size}종 · 실패 ${errors.length} · 경고 ${warnings.length}`);
process.exit(errors.length ? 1 : 0);
