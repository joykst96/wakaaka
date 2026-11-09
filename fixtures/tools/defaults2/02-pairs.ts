// 2단계 입력: A1 정규 대분류 표(a1-major-map.json)로 일반 태그의 `대분류 > 소분류` 쌍을 정규 대분류별로 모은다.
// 정규 대분류마다 a2-in-<번호>.tsv. 큰 정규 대분류는 여러 파일로 나누지 않고 한 파일에 둔다(소분류 이름을 한 사람이 정하게).
import { readFileSync, writeFileSync } from "node:fs";
import { brief, byPopularity, loadTags, WORK, type Tag } from "./load.ts";

const a1 = JSON.parse(readFileSync(`${WORK}/a1-major-map.json`, "utf8")) as { canonical: Record<string, { categories: number[] }>; map: Record<string, string> };
const general = loadTags().filter((t) => t.category === 0 && t.major);
const byCanon = new Map<string, Map<string, Tag[]>>();
for (const t of general) {
  const c = a1.map[t.major!];
  if (!c) throw new Error(`major not in a1 map: ${t.major}`);
  const pairs = byCanon.get(c) ?? byCanon.set(c, new Map()).get(c)!;
  const k = `${t.major} > ${t.minor}`;
  (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(t);
}
const index: Array<{ file: string; canonical: string; pairs: number; tags: number }> = [];
[...byCanon].sort((a, b) => b[1].size - a[1].size).forEach(([canon, pairs], i) => {
  const rows = [...pairs].sort((a, b) => b[1].length - a[1].length).map(([k, ts]) => {
    const s = [...ts].sort(byPopularity);
    // 큰 쌍은 대표 태그를 여럿, 작은 쌍은 이름만
    const sample = ts.length >= 5 ? s.slice(0, 4).map((t) => brief(t, 20)).join(" / ") : s.slice(0, 3).map((t) => brief(t, 30)).join(" / ");
    return `${k}\t${ts.length}\t${sample}`;
  });
  const file = `a2-in-${String(i + 1).padStart(2, "0")}.tsv`;
  writeFileSync(`${WORK}/${file}`, ["pair\tcount\tsample_tags"].concat(rows).join("\n") + "\n");
  index.push({ file, canonical: canon, pairs: pairs.size, tags: [...pairs.values()].reduce((n, t) => n + t.length, 0) });
});
writeFileSync(`${WORK}/a2-index.json`, JSON.stringify(index, null, 1));
for (const x of index) console.log(`${x.file}\t${x.canonical}\tpairs ${x.pairs}\ttags ${x.tags}`);
