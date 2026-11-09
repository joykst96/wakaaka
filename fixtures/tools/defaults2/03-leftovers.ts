// 3단계 입력: A2(쌍 → 대상)로 배정되지 않은 일반 태그를 태그 단위로 배정할 묶음 파일을 만든다.
// 남는 것: 3개 미만 쌍의 태그, A2가 `@다른 정규 대분류`로 보낸 쌍의 태그, 한 단계 표시(`[표정]`)만 있는 태그.
// 결과: a3-targets.tsv(배정할 수 있는 대상 전체), a3-in-NNN.tsv(300개씩).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { byPopularity, loadTags, WORK, type Tag } from "./load.ts";

const BATCH = 300;
const a1 = JSON.parse(readFileSync(`${WORK}/a1-major-map.json`, "utf8")) as { map: Record<string, string> };
const outs = readdirSync(WORK).filter((f) => /^a2-out-\d+\.json$/.test(f)).sort();
if (outs.length !== 34) throw new Error(`expected 34 a2-out files, got ${outs.length}`);
const pairTarget = new Map<string, string>();
const targets: Array<{ name: string; desc: string }> = [];
for (const f of outs) {
  const o = JSON.parse(readFileSync(`${WORK}/${f}`, "utf8")) as { canonical: string; targets: Array<{ name: string; desc: string }>; map: Record<string, string> };
  targets.push(...o.targets);
  for (const [k, v] of Object.entries(o.map)) pairTarget.set(k, v);
}
const names = new Set(targets.map((t) => t.name));
if (names.size !== targets.length) throw new Error("duplicate target names");
for (const v of pairTarget.values()) if (!v.startsWith("@") && !names.has(v)) throw new Error(`unknown target ${v}`);

const left: Array<{ t: Tag; hint: string }> = [];
for (const t of loadTags().filter((t) => t.category === 0)) {
  if (!t.major) {
    left.push({ t, hint: `[${t.single ?? ""}]` });
    continue;
  }
  const v = pairTarget.get(`${t.major} > ${t.minor}`);
  if (v && !v.startsWith("@")) continue;
  const canon = v ? v.slice(1) : a1.map[t.major]!;
  left.push({ t, hint: `${t.major} > ${t.minor} → ${canon}` });
}
// 비슷한 것끼리 한 묶음에 오게 힌트 순, 그 안에서는 인기순
left.sort((a, b) => (a.hint < b.hint ? -1 : a.hint > b.hint ? 1 : byPopularity(a.t, b.t)));
writeFileSync(`${WORK}/a3-targets.tsv`, ["target\tdesc"].concat(targets.map((t) => `${t.name}\t${t.desc}`)).join("\n") + "\n");
let n = 0;
for (let i = 0; i < left.length; i += BATCH, n++) {
  const rows = left.slice(i, i + BATCH).map(({ t, hint }) => `${t.name}\t${t.postCount}\t${hint}\t${t.body.replace(/\s+/g, " ").slice(0, 60)}`);
  writeFileSync(`${WORK}/a3-in-${String(n + 1).padStart(3, "0")}.tsv`, ["tag\tpost_count\thint\tbody"].concat(rows).join("\n") + "\n");
}
console.log(`targets ${targets.length}, leftover tags ${left.length}, batches ${n}`);
