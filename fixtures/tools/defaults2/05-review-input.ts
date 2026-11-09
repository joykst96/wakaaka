// 5단계 입력: 조립한 일반 묶음을 검토용 파일로 나눈다(정규 대분류 단위, 큰 것은 묶음 경계에서 나눔, 파일당 태그 약 1,800개 이하).
// a4-in-NN.md: "## 묶음 이름 (개수) — 설명" 아래 "태그 | 설명 앞부분" 줄. 검토 결과는 a4-out-NN.json({태그: 새 묶음}).
import { readFileSync, writeFileSync } from "node:fs";
import { escapeText, promptTag } from "@wakaaka/core";
import { loadTags, WORK } from "./load.ts";

const LIMIT = 1800;
const tags = loadTags();
const byText = new Map(tags.map((t) => [escapeText(promptTag(t.name), false, true), t]));
const j = JSON.parse(readFileSync(`${WORK}/defaults.json`, "utf8")) as { wildcards: Array<{ name: string; doc: { description: string; items: Array<{ text: string }> } }> };
const general = j.wildcards.filter((w) => w.doc.description.startsWith("Danbooru 일반 태그"));
const byCanon = new Map<string, typeof general>();
for (const w of general) {
  const c = w.name.split(" > ")[0]!;
  (byCanon.get(c) ?? byCanon.set(c, []).get(c)!).push(w);
}
const files: string[][] = [];
let cur: string[] = [];
let n = 0;
for (const ws of [...byCanon.values()]) {
  for (const w of ws) {
    if (n > 0 && n + w.doc.items.length > LIMIT) {
      files.push(cur);
      cur = [];
      n = 0;
    }
    const desc = /\((.*)\)\. 모두 같은 확률/.exec(w.doc.description)?.[1] ?? "";
    cur.push(`\n## ${w.name} (${w.doc.items.length}) — ${desc}`);
    for (const it of w.doc.items) {
      const t = byText.get(it.text)!;
      cur.push(`${t.name} | ${t.body.replace(/\s+/g, " ").slice(0, 28)}`);
    }
    n += w.doc.items.length;
  }
}
if (cur.length) files.push(cur);
files.forEach((lines, i) => writeFileSync(`${WORK}/a4-in-${String(i + 1).padStart(2, "0")}.md`, lines.join("\n").trimStart() + "\n"));
writeFileSync(`${WORK}/a4-targets.txt`, general.map((w) => w.name).join("\n") + "\n");
console.log(`general groups ${general.length}, review files ${files.length}`);
