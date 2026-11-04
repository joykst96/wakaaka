// 출력 안전 (DESIGN 9절 7항): 소스에 HTML 문자열을 DOM에 넣는 길이 없는지, href를 사용자 문자열로 만들지 않는지 훑는다.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const src = join(import.meta.dirname, "..", "src");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "design-tokens" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));
const files = walk(src).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");

describe("출력 안전", () => {
  test("HTML 문자열을 DOM에 넣는 API를 쓰지 않는다", () => {
    const banned = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|createContextualFragment/;
    const hits = files.filter((f) => banned.test(read(f).replace(/\/\/.*$/gm, ""))).map((f) => relative(src, f));
    expect(hits).toEqual([]);
  });

  test("href는 routes.ts의 hrefOf로만 만든다", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = read(f);
      for (const m of text.matchAll(/\bhref\s*=\s*\{([^}]*)\}/g)) if (!/^\s*hrefOf\(/.test(m[1]!)) hits.push(`${relative(src, f)}: ${m[0]}`);
      for (const m of text.matchAll(/\bhref\s*=\s*"([^"]*)"/g)) hits.push(`${relative(src, f)}: ${m[0]}`);
      if (/\.href\s*=/.test(text)) hits.push(`${relative(src, f)}: .href =`);
    }
    expect(hits).toEqual([]);
  });

  test("마크다운 렌더러를 쓰지 않는다(설명은 글자 그대로)", () => {
    const pkg = JSON.parse(readFileSync(join(src, "..", "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(Object.keys(pkg.devDependencies).filter((d) => /markdown|marked|remark|showdown|dompurify|sanitize-html/.test(d))).toEqual([]);
  });

  test("core/hash(node:crypto)를 웹에 넣지 않는다", () => {
    // 주석은 보지 않고 import만 본다
    const imports = /(?:from|import)\s*\(?\s*["'](?:@wakaaka\/core\/hash|node:crypto)["']/;
    expect(files.filter((f) => imports.test(read(f))).map((f) => relative(src, f))).toEqual([]);
  });
});
