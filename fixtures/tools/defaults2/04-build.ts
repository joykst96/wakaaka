// 4단계: 묶은 결과를 모아 seed.ts가 읽는 examples 형식(data/defaults-work/defaults.json)과 요약(summary.tsv)을 만든다.
// 일반 = A2(쌍) + A3(태그) [+ a4-moves.json(검토로 옮긴 태그)], 캐릭터 = B 작품 표, 메타 = C 묶음, 작가·작품 = post_count 순 구간.
// 검증: 이름 규칙, 문서 크기, 항목 수, 태그가 정확히 한 번(제외 목록 빼고) 들어갔는지.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { escapeText, MAX_ITEMS, NAME_FORBIDDEN, promptTag } from "@wakaaka/core";
import { canonicalize } from "@wakaaka/core/hash";
import { OWNER, sourceLabelFor } from "../build-defaults.ts";
import { byPopularity, CSV, loadTags, WORK, type Tag } from "./load.ts";

const MIN_GROUP = 10; // 이보다 작은 일반 묶음은 그 정규 대분류의 기타로
const MIN_WORK = 10; // 캐릭터가 이보다 적은 작품은 작품별로 만들지 않는다
const DOC_BYTES_MAX = 256 * 1024;
/** post_count 순 구간: 1~1,000, 1,001~5,000, 그 뒤 5,000개씩 */
function tiers(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let from = 0; from < n; ) {
    const size = from === 0 ? 1000 : from === 1000 ? 4000 : 5000;
    out.push([from, Math.min(from + size, n)]);
    from += size;
  }
  return out;
}
const fmt = (n: number) => n.toLocaleString("en-US");
const read = <T,>(f: string) => JSON.parse(readFileSync(`${WORK}/${f}`, "utf8")) as T;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function b62(input: string, n: number): string {
  let x = BigInt("0x" + createHash("sha256").update(input).digest("hex"));
  let s = "";
  for (let i = 0; i < n; i++) {
    s += B62[Number(x % 62n)];
    x /= 62n;
  }
  return s;
}
function items(tags: Tag[]) {
  const used = new Set<string>();
  return tags.map((t) => {
    let id = "";
    for (let n = 6; n <= 16; n += 2) {
      id = b62(`wakaaka-default-item/${t.name}`, n);
      if (!used.has(id)) break;
    }
    if (used.has(id)) throw new Error(`item id collision: ${t.name}`);
    used.add(id);
    return { id, text: escapeText(promptTag(t.name), false, true) };
  });
}

const bytes = readFileSync(CSV);
const source = sourceLabelFor("danbooru-tags.csv", createHash("sha256").update(bytes).digest("hex"), true);
const everything = loadTags();
const byName = new Map(everything.map((t) => [t.name, t]));
const placed = new Map<string, string>(); // 태그 → 와일드카드 이름
const excluded = new Map<string, string>(); // 태그 → 이유
// 미성년자를 성적으로 다루는 태그는 넣지 않는다(a5-exclude-minors.json). 묶기 전에 빼서 구간·개수가 맞게
const minors = read<Record<string, string[] | string>>("a5-exclude-minors.json");
for (const [k, v] of Object.entries(minors)) {
  if (k.startsWith("_")) continue;
  for (const n of v as string[]) {
    if (!byName.has(n)) throw new Error(`minor-exclusion tag not in CSV: ${n}`);
    excluded.set(n, "미성년자 성적 묘사");
  }
}
const all = everything.filter((t) => !excluded.has(t.name));
const wildcards: Array<{ id: string; name: string; categories: number[]; doc: unknown }> = [];
const summary: string[] = ["name\titems\tcategories\tbytes\ttop_tags"];

function add(name: string, desc: string, categories: number[], tags: Tag[]) {
  if (NAME_FORBIDDEN.test(name) || [...name].length > 64 || name.trim() !== name) throw new Error(`bad wildcard name: ${name}`);
  if (tags.length === 0) return;
  if (tags.length > MAX_ITEMS) throw new Error(`too many items: ${name} ${tags.length}`);
  if (wildcards.some((w) => w.name === name)) throw new Error(`duplicate wildcard name: ${name}`);
  tags.sort(byPopularity);
  for (const t of tags) {
    if (placed.has(t.name)) throw new Error(`tag placed twice: ${t.name} (${placed.get(t.name)}, ${name})`);
    placed.set(t.name, name);
  }
  const doc = { schema: 1, name, description: `${desc} 모두 같은 확률. 출처 ${source}`, select: { count: [1, 1], sep: ", " }, items: items(tags) };
  const size = Buffer.byteLength(canonicalize(doc));
  if (size > DOC_BYTES_MAX) throw new Error(`document over 256KB: ${name} ${size}`);
  wildcards.push({ id: b62(`wakaaka-default/${OWNER}/${name}`, 12), name, categories, doc });
  summary.push(`${name}\t${tags.length}\t${categories.join(",")}\t${size}\t${tags.slice(0, 6).map((t) => t.name).join(", ")}`);
}

// ---- 일반
const a1 = read<{ canonical: Record<string, { categories: number[] }>; map: Record<string, string> }>("a1-major-map.json");
const canonCats = (c: string) => (c === "동물" ? [8] : a1.canonical[c]!.categories); // 동물은 고정 분류 "사물"로(옛 생성기와 같게)
const targetDesc = new Map<string, string>();
const pairTarget = new Map<string, string>();
for (const f of readdirSync(WORK).filter((f) => /^a2-out-\d+\.json$/.test(f))) {
  const o = read<{ targets: Array<{ name: string; desc: string }>; map: Record<string, string> }>(f);
  for (const t of o.targets) targetDesc.set(t.name, t.desc);
  for (const [k, v] of Object.entries(o.map)) pairTarget.set(k, v);
}
const tagTarget = new Map<string, string>();
for (const f of readdirSync(WORK).filter((f) => /^a3-out-\d+\.json$/.test(f))) for (const [k, v] of Object.entries(read<Record<string, string>>(f))) tagTarget.set(k, v);
const moves = existsSync(`${WORK}/a4-moves.json`) ? read<Record<string, string>>("a4-moves.json") : {};
const general = all.filter((t) => t.category === 0);
const gGroups = new Map<string, Tag[]>();
const unassigned: string[] = [];
for (const t of general) {
  let target = moves[t.name];
  if (!target && t.major) {
    const v = pairTarget.get(`${t.major} > ${t.minor}`);
    if (v && !v.startsWith("@")) target = v;
  }
  target ??= tagTarget.get(t.name);
  if (!target || !targetDesc.has(target)) {
    unassigned.push(`${t.name} → ${target}`);
    continue;
  }
  (gGroups.get(target) ?? gGroups.set(target, []).get(target)!).push(t);
}
if (unassigned.length > 0) throw new Error(`general tags without a valid target: ${unassigned.length}, e.g. ${unassigned.slice(0, 5).join("; ")}`);
// 작은 묶음은 기타로
for (const [name, ts] of [...gGroups]) {
  const canon = name.split(" > ")[0]!;
  const etc = `${canon} > 기타`;
  if (name !== etc && ts.length < MIN_GROUP) {
    (gGroups.get(etc) ?? gGroups.set(etc, []).get(etc)!).push(...ts);
    gGroups.delete(name);
  }
}
for (const [name, ts] of [...gGroups].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const canon = name.split(" > ")[0]!;
  add(name, `Danbooru 일반 태그 [${name}] ${fmt(ts.length)}개 중 하나(${targetDesc.get(name)}).`, canonCats(canon), ts);
}

// ---- 캐릭터
const b = read<{ works: Array<{ name: string; keys: string[] }> }>("b-works.json");
const keyWork = new Map<string, string>();
for (const w of b.works) for (const k of w.keys) keyWork.set(k, w.name);
const qual = (t: Tag) => /\(([^()]+)\)$/.exec(t.name)?.[1] ?? null;
const chars = all.filter((t) => t.category === 4);
const cGroups = new Map<string, Tag[]>();
const cLeft: Tag[] = [];
for (const c of chars) {
  const q = qual(c);
  const w = (q && keyWork.get(`q:${q}`)) || (c.minor && keyWork.get(`b:${c.minor}`)) || null;
  if (w) (cGroups.get(w) ?? cGroups.set(w, []).get(w)!).push(c);
  else cLeft.push(c);
}
for (const [w, cs] of [...cGroups].sort((x, y) => y[1].length - x[1].length)) {
  if (cs.length < MIN_WORK) {
    cLeft.push(...cs);
    continue;
  }
  add(`캐릭터 > ${w}`, `Danbooru 캐릭터 태그 중 ${w} 캐릭터 ${fmt(cs.length)}명 중 하나.`, [1], cs);
}
cLeft.sort(byPopularity);
for (const [from, to] of tiers(cLeft.length))
  add(`캐릭터 > 기타 ${fmt(from + 1)}~${fmt(to)}위`, `작품별 묶음에 들지 않은 Danbooru 캐릭터 태그 ${fmt(cLeft.length)}개 중 post_count 순 ${fmt(from + 1)}~${fmt(to)}번째에서 하나.`, [1], cLeft.slice(from, to));

// ---- 작가·작품
for (const [cat, label, cats] of [[1, "작가", [2]], [3, "작품", [1]]] as const) {
  const ts = all.filter((t) => t.category === cat).sort(byPopularity);
  for (const [from, to] of tiers(ts.length))
    add(`${label} > ${fmt(from + 1)}~${fmt(to)}위`, `Danbooru ${label} 태그 ${fmt(ts.length)}개 중 post_count 순 ${fmt(from + 1)}~${fmt(to)}번째에서 하나.`, [...cats], ts.slice(from, to));
}

// ---- 메타
const c = read<{ groups: Array<{ name: string; tags: string[] }>; exclude: Array<{ tag: string; why: string }> }>("c-meta.json");
const keepMeta = new Set(existsSync(`${WORK}/c-meta-keep.json`) ? read<string[]>("c-meta-keep.json") : []); // 사용자가 제외에서 되살린 것
for (const e of c.exclude) if (!keepMeta.has(e.tag)) excluded.set(e.tag, e.why);
for (const g of c.groups) {
  const ts = g.tags.filter((n) => !excluded.has(n)).map((n) => byName.get(n)!);
  add(g.name, `Danbooru 메타 태그 [${g.name}] ${fmt(ts.length)}개 중 하나.`, [13], ts);
}
const revived = c.exclude.filter((e) => keepMeta.has(e.tag)).map((e) => byName.get(e.tag)!);
if (revived.length > 0) add("메타 > 기타", `Danbooru 메타 태그 중 묶음에 들지 않은 ${fmt(revived.length)}개 중 하나.`, [13], revived);

// ---- 검증: 모든 태그가 한 번(제외 빼고)
const missing = everything.filter((t) => !placed.has(t.name) && !excluded.has(t.name));
if (missing.length > 0) throw new Error(`tags not placed: ${missing.length}, e.g. ${missing.slice(0, 5).map((t) => t.name).join(", ")}`);
for (const n of excluded.keys()) if (placed.has(n)) throw new Error(`excluded tag placed: ${n}`);

writeFileSync(`${WORK}/defaults.json`, JSON.stringify({ format: "wakaaka-examples/1", owner: OWNER, wildcards }));
writeFileSync(`${WORK}/summary.tsv`, summary.join("\n") + "\n");
const count = (p: string) => wildcards.filter((w) => w.name.startsWith(p)).length;
console.log(`wildcards ${wildcards.length}, tags ${placed.size} of ${everything.length}, excluded ${excluded.size} (minors ${[...excluded.values()].filter((v) => v === "미성년자 성적 묘사").length})`);
console.log(`  general ${general.length} tags → ${gGroups.size}; characters → works ${count("캐릭터 > ") - count("캐릭터 > 기타 ")} + tiers ${count("캐릭터 > 기타 ")} (left ${cLeft.length}); artists ${count("작가 > ")}; works ${count("작품 > ")}; meta ${c.groups.length + (revived.length > 0 ? 1 : 0)}`);
console.log(`  largest doc ${Math.max(...summary.slice(1).map((l) => Number(l.split("\t")[3])))} bytes`);
