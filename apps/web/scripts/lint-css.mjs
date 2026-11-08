// 앱 스타일 검사 (DESIGN 10절 "디자인 토큰"). npm run lint:css, npm test가 부른다.
//  1) design-tokens/scripts/check.mjs: 날 값(색·시간), 미정의 토큰, 토큰 층 방향. 앱 파일의 길이 리터럴("고유 치수")도 실패로 본다
//  2) 층 규칙: app.css·folders.css와 CodeMirror 테마(.ts)는 2층과 앱 3층(styles/components.css에서 정의한 것)만,
//     components.css는 2층과 1층 "스케일"(간격·라운드·테두리·크기·z, 팔레트 색 제외)만 참조한다
//  3) TS/TSX: var(--x)는 정의된 토큰이어야 하고, 테마 문자열에 색·길이 리터럴이 없어야 한다
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensDir = join(web, "src/design-tokens");
// 0번은 앱 3층(components.css), 나머지는 앱 CSS(2층과 앱 3층만). folders.css는 폴더 화면(DESIGN 11절 "폴더")
const appCss = [join(web, "src/styles/components.css"), join(web, "src/styles/app.css"), join(web, "src/styles/folders.css")];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const defs = (file) => new Set([...strip(readFileSync(file, "utf8")).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const refs = (text) => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => [m[1], m.index]);
const lineOf = (text, i) => text.slice(0, i).split("\n").length;

const errors = [];

// 1) check.mjs
const r = spawnSync(process.execPath, [join(tokensDir, "scripts/check.mjs"), ...appCss], { encoding: "utf8" });
const out = r.stdout + r.stderr;
for (const line of out.split("\n")) if (line.startsWith("실패") || line.startsWith("고유 치수")) errors.push(`check.mjs: ${line}`);
if (r.status !== 0 && errors.length === 0) errors.push(`check.mjs exited ${r.status}: ${out}`);

// 2) 층 규칙
const L1 = defs(join(tokensDir, "tokens/1-primitives.css"));
const L2 = defs(join(tokensDir, "tokens/2-semantic.css"));
const appL3 = defs(appCss[0]);
const palette = /^--(?:gray|blue|green|amber|red|purple|orange|alpha|mix)-/;
const scale = /^--(?:space|radius|border-width|size|z)-/;
for (const t of appL3) if (L1.has(t) || L2.has(t)) errors.push(`components.css가 공용 토큰 ${t}를 다시 정의함`);

const check = (file, allowed, what) => {
  const text = strip(readFileSync(file, "utf8"));
  for (const [name, i] of refs(text)) if (!allowed(name)) errors.push(`${relative(web, file)}:${lineOf(text, i)} ${what}: ${name}`);
};
check(appCss[0], (n) => L2.has(n) || (L1.has(n) && scale.test(n) && !palette.test(n)) || appL3.has(n), "앱 3층은 2층과 1층 스케일만");
for (const f of appCss.slice(1)) check(f, (n) => L2.has(n) || appL3.has(n), "앱 CSS는 2층과 앱 3층만");

// 3) TS/TSX
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "design-tokens" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));
for (const file of walk(join(web, "src")).filter((f) => /\.tsx?$/.test(f))) {
  const text = readFileSync(file, "utf8");
  for (const [name, i] of refs(text)) if (!(L2.has(name) || appL3.has(name))) errors.push(`${relative(web, file)}:${lineOf(text, i)} TS의 토큰은 2층과 앱 3층만: ${name}`);
  if (/EditorView\.(base)?[Tt]heme\(/.test(text)) {
    for (const m of text.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      const s = m[1];
      if (/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s)(?![\w-])/.test(s)) {
        errors.push(`${relative(web, file)}:${lineOf(text, m.index)} 테마에 날 값: ${s}`);
      }
    }
  }
}

for (const e of errors) console.log("실패  " + e);
console.log(`앱 스타일 검사: 실패 ${errors.length}`);
process.exit(errors.length ? 1 : 0);
