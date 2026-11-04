// 3층 토큰을 파일 하나로 합친다 (배포용 — @import 연쇄 요청을 없앰): node scripts/bundle.mjs <출력 경로>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) {
  console.error("사용법: node scripts/bundle.mjs <출력 경로>");
  process.exit(1);
}
const layers = ["tokens/1-primitives.css", "tokens/2-semantic.css", "tokens/3-components.css"];
const header =
  "/* 생성 파일 — 직접 고치지 말 것.\n" +
  "   원본: C:\\workspace\\design-tokens (tokens/1-primitives.css · 2-semantic.css · 3-components.css)\n" +
  "   다시 만들기: node <design-tokens>/scripts/bundle.mjs <이 파일 경로> */\n\n";
writeFileSync(out, header + layers.map((p) => readFileSync(join(root, p), "utf8")).join("\n"));
console.log(`${out} ← ${layers.length}개 층`);
