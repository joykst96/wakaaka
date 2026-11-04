// 토큰 규칙 검사 (의존성 없음): node scripts/check.mjs [앱 파일(.css/.html) ...]
//  1) 날 값 금지   — 1층 밖(2·3층, base.css, ui.css)에 hex/rgb/길이·시간 리터럴이 있으면 실패
//  2) 참조 방향   — 1층은 다른 층을, 2층은 3층을 참조하면 실패 (아래층만 위층을 본다)
//  3) 미정의 참조 — var(--x)의 --x가 어디에도 정의돼 있지 않으면 실패 (CSS는 오타를 조용히 무시한다)
//  4) 미사용 팔레트 — 어디서도 안 쓰는 1층 색·투명도 토큰은 경고만
//     (간격·라운드·글자 크기 같은 스케일은 앱이 쓰라고 둔 것이라 검사하지 않는다)
//  앱 파일을 넘기면 그 파일도 검사한다 (.html은 <style>과 style="" 속성만):
//     색·시간 리터럴과 미정의 참조는 실패, 길이 리터럴은 "고유 치수"로 목록만 보여 준다
//     (라이트박스 버튼 크기처럼 그 화면에만 있는 치수는 토큰이 아니어도 된다 — 대신 눈에 보이게).
//     @media 조건은 var()를 쓸 수 없으므로 제외한다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const layers = [
  ["tokens/1-primitives.css", 1],
  ["tokens/2-semantic.css", 2],
  ["tokens/3-components.css", 3],
  ["base.css", 4],
  ["ui.css", 4],
];

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const files = layers.map(([path, layer]) => ({ path, layer, css: stripComments(readFileSync(join(root, path), "utf8")) }));

// 앱 파일: 5층. HTML이면 <style> 블록과 style="" 속성만 뽑는다 (줄 번호 유지를 위해 나머지는 빈 줄로).
const APP = 5;
for (const arg of process.argv.slice(2)) {
  let text = readFileSync(resolve(arg), "utf8");
  if (arg.endsWith(".html")) {
    const keep = [];
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style="([^"]*)"/g)) keep.push([m.index, m[1] ?? `x{${m[2]}}`]);
    let out = "", at = 0;
    for (const [i, s] of keep) {
      out += text.slice(at, i).replace(/[^\n]/g, "") + s;
      at = i + (text.slice(i).match(/<style[^>]*>[\s\S]*?<\/style>|style="[^"]*"/)[0].length);
    }
    text = out + text.slice(at).replace(/[^\n]/g, "");
  }
  // @media 조건은 var()를 못 쓰므로 조건 부분만 지운다
  files.push({ path: arg, layer: APP, css: stripComments(text).replace(/@media[^{]*/g, (s) => s.replace(/[^\n]/g, " ")) });
}

const definedIn = new Map(); // 토큰 → 정의된 층
for (const f of files)
  for (const [, name] of f.css.matchAll(/(--[\w-]+)\s*:/g)) if (!definedIn.has(name)) definedIn.set(name, f.layer);

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

// 4) 미사용 팔레트
const palette = /^--(?:gray|blue|green|amber|red|alpha|mix)-/;
for (const [name, layer] of definedIn)
  if (layer === 1 && palette.test(name) && !used.has(name)) warnings.push(`미사용 팔레트 ${name}`);

for (const d of appDims) console.log("고유 치수  " + d);
for (const w of warnings) console.log("경고  " + w);
for (const e of errors) console.log("실패  " + e);
console.log(`\n토큰 ${definedIn.size}개 · 참조 ${used.size}종 · 실패 ${errors.length} · 경고 ${warnings.length}`);
process.exit(errors.length ? 1 : 0);
