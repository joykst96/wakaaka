// 토큰 원본 읽기 — check.mjs · manifest.mjs 공용 (의존성 없음)
//
// 기본은 이 스크립트가 든 폴더의 토큰이다. --tokens <경로>를 주면 그 토큰을 기준으로 삼는다.
//   폴더 → 그 폴더의 tokens/1-primitives.css … (폴더째 복사한 프로젝트)
//   파일 → bundle.mjs로 만든 번들. 층 머리 주석("N층 · …")을 보고 세 층으로 다시 나눈다.
// 왜 필요한가: 프로젝트가 든 사본은 원본보다 오래됐을 수 있다. 원본 기준으로 검사하면
// 사본에 없는 토큰이 "정의됨"으로 통과하고, 화면에서는 조용히 무시된다.
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAYER_FILES = ["tokens/1-primitives.css", "tokens/2-semantic.css", "tokens/3-components.css"];
const EXTRA_FILES = ["base.css", "ui.css"]; // 토큰을 쓰는 쪽(4층). 번들에는 없다.

/** argv에서 --tokens <경로>를 떼어 낸다. */
export function takeTokensArg(argv) {
  const i = argv.indexOf("--tokens");
  if (i === -1) return { tokens: null, rest: argv };
  if (!argv[i + 1]) throw new Error("--tokens 뒤에 폴더나 번들 파일 경로가 필요하다");
  return { tokens: argv[i + 1], rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

/** @returns {{ label: string, layers: {path: string, layer: number, raw: string}[], extras: {path: string, layer: number, raw: string}[] }} */
export function loadTokens(tokensPath) {
  const base = tokensPath ? resolve(tokensPath) : here;
  if (!existsSync(base)) throw new Error(`토큰 경로가 없다: ${base}`);

  if (statSync(base).isDirectory()) {
    const missing = LAYER_FILES.filter((p) => !existsSync(join(base, p)));
    if (missing.length) throw new Error(`${base} 에 ${missing.join(", ")} 이(가) 없다 (번들 파일이면 그 파일 경로를 준다)`);
    const read = (p, layer) => ({ path: p, layer, raw: readFileSync(join(base, p), "utf8") });
    return {
      label: tokensPath ? base : "이 저장소",
      layers: LAYER_FILES.map((p, i) => read(p, i + 1)),
      extras: EXTRA_FILES.filter((p) => existsSync(join(base, p))).map((p) => read(p, 4)),
    };
  }

  // 번들: 층 머리 주석 위치에서 자른다. 줄 번호가 번들 파일 기준으로 남도록 앞부분은 빈 줄로 채운다.
  const text = readFileSync(base, "utf8");
  const marks = [...text.matchAll(/\/\*[\s=]*([123])층 · /g)].map((m) => ({ at: m.index, layer: +m[1] }));
  const found = marks.map((m) => m.layer).join("");
  if (found !== "123") throw new Error(`${base}: 층 머리 주석(1층·2층·3층)을 찾지 못했다 (찾은 것: "${found}"). bundle.mjs로 만든 파일이 맞는지 확인한다`);
  const name = base.replace(/\\/g, "/").split("/").pop();
  return {
    label: base,
    layers: marks.map((m, i) => ({
      path: name,
      layer: m.layer,
      raw: text.slice(0, m.at).replace(/[^\n]/g, "") + text.slice(m.at, marks[i + 1]?.at),
    })),
    extras: [],
  };
}
