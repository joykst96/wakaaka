// 운영의 기본 와일드카드를 태그 CSV로 만든다 (DESIGN 10절 "운영 배포" > "기본 와일드카드", 사용자 결정 2026-11-04).
// 결과는 seed.ts가 읽는 examples 형식(fixtures/out/defaults.json)이고 커밋하지 않는다.
//
//   node fixtures/tools/build-defaults.ts <danbooru-tags.csv> [출력 파일]
//
// - 대상: 맨 앞이 [대분류 > 소분류]이고 그 표시를 뺀 본문이나 키워드에 한글이 있는 행. 표시 자체가 한글이라 설명 전체로 보면 안 된다.
//   NSFW를 거르지 않는다(테스트 예시와 다름).
// - Danbooru 일반(general) 태그는 [대분류 > 소분류]마다 하나. 아티스트·캐릭터·작품·메타는 분류 전체를 post_count 내림차순 5,000개씩.
// - 항목은 태그 하나씩, 가중치는 모두 1(w를 적지 않음), 개수 1~1. 텍스트는 자동완성과 같은 표기(항목 맨 앞이라 #로 시작하는 태그는 #, 2026-11-08).
// - CSV 읽기는 태그 가져오기와 같은 코드(apps/api tagcsv.ts)를 쓴다. 같은 파일을 같게 읽게.
// - 와일드카드 ID(파일 안에서만 쓰는 임시 ID)와 항목 ID는 이름의 해시라 다시 만들어도 같다. 서버는 와일드카드 ID를 새로 준다.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { escapeText, MAX_ITEMS, NAME_FORBIDDEN, promptTag } from "@wakaaka/core";
import { canonicalize } from "@wakaaka/core/hash";
import { descriptionGroup, hasHangul, readTagCsv, splitDescription, type TagRecord } from "../../apps/api/src/services/tagcsv.ts";

export const OWNER = "wakaaka";
const CHUNK = MAX_ITEMS; // 5,000
const DOC_BYTES_MAX = 256 * 1024;

// 고정 분류 ID (DESIGN 3절, 1~13)
const C = { char: 1, artist: 2, person: 3, body: 4, face: 5, wear: 6, pose: 7, object: 8, place: 9, camera: 10, situation: 11, preset: 12, etc: 13 };
/** 설명의 대분류 → 고정 분류. 없는 대분류는 기타 */
const MAJOR: Record<string, number[]> = {
  캐릭터: [C.char],
  "작품/출처": [C.char],
  아티스트: [C.artist],
  인물: [C.person],
  신체: [C.body],
  머리카락: [C.body],
  "얼굴/눈": [C.face],
  "표정/감정": [C.face],
  의상: [C.wear],
  액세서리: [C.wear],
  행동: [C.pose],
  "포즈/구도": [C.pose, C.camera],
  사물: [C.object],
  "동물/생물": [C.object],
  "배경/장소": [C.place],
  "효과/연출": [C.camera],
  "색상/패턴": [C.etc],
  메타: [C.etc],
  // 헤더 없는 형식(mengod-hf)의 대분류. 태그 10개 이상인 쌍에 나오는 65개(NOTES 2026-11-08). 위의 같은 이름은 뜻이 같아 그대로 쓴다
  작품: [C.char],
  게임: [C.char],
  패러디: [C.char],
  코스프레: [C.char, C.wear],
  화풍: [C.artist],
  그림체: [C.artist],
  스타일: [C.artist],
  관계: [C.person],
  외형: [C.body],
  헤어: [C.body],
  머리: [C.body],
  속성: [C.body],
  "신체 장식": [C.body],
  표정: [C.face],
  패션: [C.wear],
  복장: [C.wear],
  의류: [C.wear],
  장신구: [C.wear],
  장식: [C.wear],
  행위: [C.pose],
  포즈: [C.pose],
  자세: [C.pose],
  동작: [C.pose],
  H: [C.pose],
  성인: [C.pose],
  성적: [C.pose],
  "성적 표현": [C.pose],
  무기: [C.object],
  음식: [C.object],
  탈것: [C.object],
  소품: [C.object],
  동물: [C.object],
  식물: [C.object],
  생물: [C.object],
  장비: [C.object],
  오브젝트: [C.object],
  아이템: [C.object],
  도구: [C.object],
  브랜드: [C.object],
  배경: [C.place],
  자연: [C.place],
  장소: [C.place],
  구도: [C.camera],
  연출: [C.camera],
  효과: [C.camera],
  표현: [C.camera],
  상황: [C.situation],
  행사: [C.situation],
  이벤트: [C.situation],
  문화: [C.situation],
  밈: [C.situation],
  설정: [C.situation],
};
/** 헤더 없는 형식에서 일반 태그 쌍을 와일드카드로 만드는 최소 태그 수(DESIGN 10절, 사용자 결정 2026-11-08) */
export const MIN_GENERAL_GROUP = 10;
/** 일반이 아닌 Danbooru 분류: 이름, 고정 분류 */
const CHUNKED: Record<number, { label: string; categories: number[] }> = {
  1: { label: "아티스트", categories: [C.artist] },
  4: { label: "캐릭터", categories: [C.char] },
  3: { label: "작품/출처", categories: [C.char] },
  5: { label: "메타", categories: [C.etc] },
};

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

export interface DefaultsResult {
  examples: { format: "wakaaka-examples/1"; owner: string; wildcards: Array<{ id: string; name: string; categories: number[]; doc: unknown }> };
  summary: Array<{ name: string; items: number; bytes: number }>;
  rows: number;
  used: number;
  /** 헤더 없는 형식에서 쌍이 없거나 태그가 MIN_GENERAL_GROUP개 미만인 쌍이라 넣지 않은 일반 태그 */
  skippedGeneral: number;
}

const byPopularity = (a: TagRecord, b: TagRecord) => b.postCount - a.postCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** 항목 ID: 태그 이름 해시 6자. 문서 안에서 겹치면 길게 한다(ITEM_ID는 16자까지) */
function items(tags: TagRecord[]) {
  const used = new Set<string>();
  return tags.map((t) => {
    let id = "";
    for (let n = 6; n <= 16; n += 2) {
      id = b62(`wakaaka-default-item/${t.name}`, n);
      if (!used.has(id)) break;
    }
    if (used.has(id)) throw new Error(`item id collision: ${t.name}`);
    used.add(id);
    // 항목 텍스트 전체가 태그라 맨 앞 자리다: #compass 같은 태그는 #로(주석이 되지 않게, SPEC 2.7)
    return { id, text: escapeText(promptTag(t.name), false, true) };
  });
}

export function buildDefaults(csvText: string, sourceLabel: string): DefaultsResult {
  const csv = readTagCsv(csvText);
  const koDesc = (r: TagRecord) => {
    const s = splitDescription(r.description);
    return hasHangul(s.body) || s.keywords.some(hasHangul);
  };
  // 헤더 없는 형식: 모든 행이 한국어 설명이고 대괄호 표시가 한 단계인 행도 있어, 일반이 아닌 분류는 표시를 보지 않는다
  const picked = csv.records.filter((r) => (csv.headerless ? hasHangul(r.body) || r.keywords.some(hasHangul) : descriptionGroup(r.description) !== null && koDesc(r)));
  const wildcards: DefaultsResult["examples"]["wildcards"] = [];
  const add = (name: string, description: string, categories: number[], tags: TagRecord[]) => {
    if (NAME_FORBIDDEN.test(name) || [...name].length > 64 || name.trim() !== name) throw new Error(`bad wildcard name: ${name}`);
    const doc = { schema: 1, name, description, select: { count: [1, 1], sep: ", " }, items: items(tags) };
    wildcards.push({ id: b62(`wakaaka-default/${OWNER}/${name}`, 12), name, categories, doc });
  };

  // 일반 태그: [대분류 > 소분류]마다
  const groups = new Map<string, { major: string; minor: string; tags: TagRecord[] }>();
  let skippedGeneral = 0;
  for (const r of picked.filter((r) => r.category === 0)) {
    const g = descriptionGroup(r.description);
    if (g === null) {
      skippedGeneral++; // 헤더 없는 형식의 한 단계 표시 `[표정]` 등. 헤더 있는 형식은 picked에서 이미 걸렀다
      continue;
    }
    const key = `${g.major} > ${g.minor}`;
    if (!groups.has(key)) groups.set(key, { ...g, tags: [] });
    groups.get(key)!.tags.push(r);
  }
  for (const [name, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (csv.headerless && g.tags.length < MIN_GENERAL_GROUP) {
      skippedGeneral += g.tags.length;
      continue;
    }
    if (g.tags.length > CHUNK) throw new Error(`general subcategory over ${CHUNK}: ${name} (${g.tags.length})`);
    g.tags.sort(byPopularity);
    const which = csv.headerless ? `한글 설명이 있고 같은 분류가 ${MIN_GENERAL_GROUP}개 이상인 것만` : "한글 설명이 있는 태그만";
    add(name, `Danbooru 일반 태그 [${name}] ${g.tags.length.toLocaleString("en-US")}개 중 하나. ${which}, 모두 같은 확률. 출처 ${sourceLabel}`, MAJOR[g.major] ?? [C.etc], g.tags);
  }

  // 그 밖의 분류: 분류 전체를 post_count 순 5,000개씩
  for (const [cat, { label, categories }] of Object.entries(CHUNKED)) {
    const tags = picked.filter((r) => r.category === Number(cat)).sort(byPopularity);
    for (let i = 0; i * CHUNK < tags.length; i++) {
      const part = tags.slice(i * CHUNK, (i + 1) * CHUNK);
      const from = i * CHUNK + 1;
      const to = i * CHUNK + part.length;
      add(
        `${label} ${i + 1}`,
        `Danbooru ${label} 태그 ${tags.length.toLocaleString("en-US")}개 중 post_count 순 ${from.toLocaleString("en-US")}~${to.toLocaleString("en-US")}번째에서 하나. 한글 설명이 있는 태그만, 모두 같은 확률. 출처 ${sourceLabel}`,
        categories,
        part,
      );
    }
  }

  const unknownCat = picked.filter((r) => r.category !== 0 && !(r.category in CHUNKED));
  if (unknownCat.length > 0) throw new Error(`tags in unexpected categories: ${unknownCat.length}`);
  const summary = wildcards.map((w) => ({ name: w.name, items: (w.doc as { items: unknown[] }).items.length, bytes: Buffer.byteLength(canonicalize(w.doc)) }));
  const big = summary.filter((s) => s.bytes > DOC_BYTES_MAX);
  if (big.length > 0) throw new Error(`documents over 256KB: ${big.map((b) => `${b.name} ${b.bytes}`).join(", ")}`);
  const used = summary.reduce((n, s) => n + s.items, 0);
  if (used + skippedGeneral !== picked.length) throw new Error(`lost tags: picked ${picked.length}, placed ${used}, skipped ${skippedGeneral}`);
  return { examples: { format: "wakaaka-examples/1", owner: OWNER, wildcards }, summary, rows: csv.records.length, used, skippedGeneral };
}

/** 출처 표시. 헤더 없는 형식은 mengod-hf 데이터셋(CC BY-SA 4.0)이라 이름과 라이선스를 적는다 */
export function sourceLabelFor(fileName: string, sha256: string, headerless: boolean): string {
  const sha = `sha256 ${sha256.slice(0, 12)}`;
  return headerless ? `Hugging Face mengod-hf/danbooru-tags-kr (${sha}), 한국어 설명 CC BY-SA 4.0` : `${fileName} (${sha})`;
}

// Node 22에는 import.meta.main이 없다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [csvPath, outArg] = process.argv.slice(2);
  if (!csvPath) {
    console.error("usage: node fixtures/tools/build-defaults.ts <danbooru-tags.csv> [out.json]");
    process.exit(1);
  }
  const bytes = readFileSync(csvPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const text = bytes.toString("utf8");
  // 서버에서는 어느 CSV든 /data/danbooru-tags.csv로 놓이므로(deploy/test-tags.sh) 이름 대신 형식으로 출처를 정한다
  const r = buildDefaults(text, sourceLabelFor("danbooru-tags.csv", sha, readTagCsv(text).headerless));
  const out = outArg ?? new URL("../out/defaults.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r.examples));
  const maxBytes = Math.max(...r.summary.map((s) => s.bytes));
  console.log(`wildcards ${r.summary.length}, tags ${r.used} of ${r.rows} rows (general skipped ${r.skippedGeneral}), largest doc ${maxBytes} bytes → ${out}`);
}
