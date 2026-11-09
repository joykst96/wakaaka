// 1단계: 기계 분류 후보 목록. Sonnet에게 줄 입력 파일을 data/defaults-work/에 쓴다.
import { mkdirSync, writeFileSync } from "node:fs";
import { brief, byPopularity, loadTags, WORK, type Tag } from "./load.ts";

const tags = loadTags();
mkdirSync(WORK, { recursive: true });
const count = <K,>(xs: K[]) => { const m = new Map<K, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

// 일반: 대분류마다 수, 주요 소분류, 대표 태그
const general = tags.filter((t) => t.category === 0);
const byMajor = new Map<string, Tag[]>();
for (const t of general) if (t.major) (byMajor.get(t.major) ?? byMajor.set(t.major, []).get(t.major)!).push(t);
const majors = [...byMajor].sort((a, b) => b[1].length - a[1].length);
const lines = ["major\tcount\ttop_minors\tsample_tags"];
for (const [m, ts] of majors) {
  const minors = count(ts.map((t) => t.minor!)).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(", ");
  const sample = [...ts].sort(byPopularity).slice(0, ts.length >= 20 ? 5 : 3).map((t) => brief(t, 25)).join(" / ");
  lines.push(`${m}\t${ts.length}\t${minors}\t${sample}`);
}
writeFileSync(`${WORK}/a1-general-majors.tsv`, lines.join("\n") + "\n");
const single = general.filter((t) => !t.major);

// 캐릭터: 이름 끝 괄호와 설명 [캐릭터 > 작품]
const chars = tags.filter((t) => t.category === 4);
const copyrights = new Map(tags.filter((t) => t.category === 3).map((t) => [t.name, t]));
const qual = (t: Tag) => /\(([^()]+)\)$/.exec(t.name)?.[1] ?? null;
const byQ = new Map<string, Tag[]>();
const byB = new Map<string, Tag[]>();
for (const c of chars) {
  const q = qual(c);
  if (q) (byQ.get(q) ?? byQ.set(q, []).get(q)!).push(c);
  if (c.minor) (byB.get(c.minor) ?? byB.set(c.minor, []).get(c.minor)!).push(c);
}
const MIN_WORK = 5;
const cl = ["key\tcount\tlinked\tcopyright_tag_ko\tsample_characters"];
for (const [q, cs] of [...byQ].filter(([, cs]) => cs.length >= MIN_WORK).sort((a, b) => b[1].length - a[1].length)) {
  const linked = count(cs.map((c) => c.minor).filter((x): x is string => !!x)).slice(0, 3).map(([k, v]) => `b:${k}:${v}`).join(", ");
  const cp = copyrights.get(q);
  const cpKo = cp ? `${cp.keywords.slice(0, 3).join("/")} (${cp.postCount})` : "";
  cl.push(`q:${q}\t${cs.length}\t${linked}\t${cpKo}\t${[...cs].sort(byPopularity).slice(0, 3).map((c) => c.name).join(" / ")}`);
}
for (const [b, cs] of [...byB].filter(([, cs]) => cs.length >= MIN_WORK).sort((a, b) => b[1].length - a[1].length)) {
  const linked = count(cs.map(qual).filter((x): x is string => !!x)).slice(0, 3).map(([k, v]) => `q:${k}:${v}`).join(", ");
  cl.push(`b:${b}\t${cs.length}\t${linked}\t\t${[...cs].sort(byPopularity).slice(0, 3).map((c) => c.name).join(" / ")}`);
}
writeFileSync(`${WORK}/b-char-works.tsv`, cl.join("\n") + "\n");

// 메타: 전부
const meta = tags.filter((t) => t.category === 5).sort(byPopularity);
writeFileSync(`${WORK}/c-meta.tsv`, ["name\tpost_count\tbracket\tbody"].concat(meta.map((t) => `${t.name}\t${t.postCount}\t${t.major ? `${t.major} > ${t.minor}` : (t.single ?? "")}\t${t.body.replace(/\s+/g, " ").slice(0, 80)}`)).join("\n") + "\n");

const qs = [...byQ.values()].map((x) => x.length);
console.log(`general ${general.length}: majors ${majors.length} (≥10 tags ${majors.filter(([, t]) => t.length >= 10).length}), single-level ${single.length}`);
console.log(`characters ${chars.length}: qualifier keys ≥${MIN_WORK} ${qs.filter((n) => n >= MIN_WORK).length}, bracket keys ≥${MIN_WORK} ${[...byB.values()].filter((x) => x.length >= MIN_WORK).length}, no qualifier ${chars.filter((c) => !qual(c)).length}`);
console.log(`meta ${meta.length}`);
