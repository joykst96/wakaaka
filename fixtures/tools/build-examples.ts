// materials/*.csv로 예시 와일드카드를 만든다. 결과는 fixtures/out/에 쓰고 커밋하지 않는다.
// 스키마가 바뀌면 이 파일만 고쳐서 다시 만든다. 재료 CSV는 스키마와 무관하다.
//
//   node fixtures/tools/build-examples.ts
//
// 와일드카드 ID는 이름에서, 항목 ID는 재료 태그 이름에서 해시로 만든다. 다시 만들어도 같은 seed는 같은 결과를 낸다.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { escapeText, promptTag } from "@wakaaka/core";

const MATERIALS = new URL("../materials/", import.meta.url);
const OUT = new URL("../out/", import.meta.url);
const OWNER = "sample";

// ---------------------------------------------------------------- 재료

type Mat = { name: string; posts: number | null; group: string; ko: string };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const mats: Record<string, Mat[]> = {};
for (const f of readdirSync(MATERIALS).filter((f) => f.endsWith(".csv"))) {
  const [head, ...rows] = parseCsv(readFileSync(new URL(f, MATERIALS), "utf8"));
  if (head.join(",") !== "name,posts,group,ko") throw new Error(`${f}: 헤더가 다름`);
  mats[f.slice(0, -4)] = rows.map(([name, posts, group, ko]) => ({ name, posts: posts ? Number(posts) : null, group, ko }));
}
const mat = (file: string) => {
  const m = mats[file];
  if (!m) throw new Error(`재료 없음: ${file}`);
  return m;
};

// ---------------------------------------------------------------- 표기

// 프롬프트 표기(밑줄, 괄호)와 문법 이스케이프는 편집기 자동완성과 같은 core 함수를 쓴다(DESIGN 11절, 잠정).
const tag = (name: string, inChoice = false) => escapeText(promptTag(name), inChoice);

// ---------------------------------------------------------------- ID

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
const wcId = (name: string) => b62(`wakaaka-example/${OWNER}/${name}`, 12);

// ---------------------------------------------------------------- 정의

type ItemDef = { key: string; text?: string; ref?: string; spread?: boolean; w?: number };
type WcDef = { name: string; description: string; categories: number[]; count?: [number, number]; sep?: string; items: ItemDef[] };
const defs: WcDef[] = [];
const def = (d: WcDef) => defs.push(d);

// 분류 ID (DESIGN 3절, 1~13)
const C = { char: 1, artist: 2, person: 3, body: 4, face: 5, wear: 6, pose: 7, object: 8, place: 9, camera: 10, situation: 11, preset: 12, etc: 13 };

// 인기 태그가 더 자주 나오되 압도하지 않게 sqrt 비율로 1~10
function weights(list: Mat[]): (m: Mat) => number | undefined {
  const max = Math.max(...list.map((m) => m.posts ?? 0));
  return (m) => {
    if (!m.posts || !max) return undefined;
    const w = Math.max(1, Math.round(10 * Math.sqrt(m.posts / max)));
    return w === 1 ? undefined : w;
  };
}

function atom(name: string, files: string[], categories: number[], description: string, opts: Partial<WcDef> = {}) {
  const list = files.flatMap(mat);
  const wf = weights(list);
  def({ name, description, categories, ...opts, items: list.map((m) => ({ key: m.name, text: tag(m.name), w: wf(m) })) });
}

const ref = (name: string, w?: number): ItemDef => ({ key: "ref:" + name, ref: name, w });
const spread = (name: string): ItemDef => ({ key: "spread:" + name, ref: name, spread: true });
const text = (key: string, t: string, w?: number): ItemDef => ({ key, text: t, w });
const W = (name: string) => "${w:" + wcId(name) + "}";

atom("hair color", ["hair_color"], [C.body], "머리색");
atom("hair length", ["hair_length"], [C.body], "머리 길이");
atom("hair style", ["hair_style"], [C.body], "헤어스타일");
atom("eye color", ["eye_color"], [C.face], "눈 색");
atom("expression", ["expression"], [C.face], "표정 1~2개", { count: [1, 2] });
atom("gesture", ["gesture"], [C.pose], "손짓, 시선");
atom("top", ["top"], [C.wear], "상의");
atom("bottom", ["bottom"], [C.wear], "하의");
atom("dress", ["dress"], [C.wear], "원피스, 드레스");
atom("school uniform", ["uniform"], [C.wear], "교복");
atom("traditional", ["traditional"], [C.wear], "전통 의상");
def({
  name: "outfit", description: "의상: 상하의 조합, 드레스, 교복, 전통 의상 중 하나(ref 항목 예시)", categories: [C.wear],
  items: [text("top+bottom", `${W("top")}, ${W("bottom")}`, 4), ref("dress", 3), ref("school uniform", 2), ref("traditional")],
});
atom("headwear", ["headwear"], [C.wear], "모자, 머리장식");
atom("legwear", ["legwear"], [C.wear], "양말, 스타킹");
atom("footwear", ["footwear"], [C.wear], "신발");
atom("eyewear", ["eyewear"], [C.wear], "안경, 고글");
atom("jewelry", ["jewelry"], [C.wear], "장신구");
def({
  name: "accessories", description: "액세서리 0~3개. 다섯 풀을 spread로 합친다(spread 예시)", categories: [C.wear], count: [0, 3],
  items: ["headwear", "legwear", "footwear", "eyewear", "jewelry"].map(spread),
});
atom("pose", ["pose"], [C.pose], "자세");
atom("action", ["action"], [C.pose], "일상 행동");
atom("framing", ["framing"], [C.camera], "프레이밍");
atom("angle", ["angle"], [C.camera], "시점, 앵글");
def({ name: "camera", description: "프레이밍 + 앵글", categories: [C.camera], items: [text("camera", `${W("framing")}, ${W("angle")}`)] });
atom("indoor", ["indoor"], [C.place], "실내");
atom("outdoor", ["outdoor"], [C.place], "실외");
atom("nature", ["nature"], [C.place], "자연");
atom("city", ["city"], [C.place], "도시");
atom("fantasy place", ["fantasy_place"], [C.place], "판타지 장소");
def({
  name: "location", description: "장소 종류를 먼저 고르고 그 안에서 하나", categories: [C.place],
  items: [ref("indoor", 3), ref("outdoor", 2), ref("nature", 3), ref("city", 2), ref("fantasy place")],
});
atom("lighting", ["lighting"], [C.situation], "조명");
atom("weather", ["weather"], [C.situation], "날씨, 시간");
def({ name: "atmosphere", description: "조명과 날씨 1~2개", categories: [C.situation], count: [1, 2], items: [spread("lighting"), spread("weather")] });

const quality = mat("quality_manual");
def({
  name: "quality", description: "품질 태그 전부(뽑힌 순서로 섞임)", categories: [C.preset], count: [5, 5],
  items: [...quality.filter((m) => m.group === "positive").slice(0, 4), ...mat("meta_quality").filter((m) => m.name === "absurdres")]
    .map((m) => text(m.name, tag(m.name))),
});
def({
  name: "negative", description: "네거티브 품질 태그 전부", categories: [C.preset], count: [6, 6],
  items: [...quality.filter((m) => m.group === "negative"), ...mat("meta_quality").filter((m) => ["lowres", "jpeg_artifacts"].includes(m.name))]
    .map((m) => text(m.name, tag(m.name))),
});
def({
  name: "girl base", description: "여자 캐릭터 외형", categories: [C.person, C.body],
  items: [text("base", `1girl, solo, ${W("hair length")}, ${W("hair color")}, ${W("hair style")}, ${W("eye color")}`)],
});

// 캐릭터 세트: "이 캐릭터가 뽑히면 이 의상도"를 조합으로 표현하는 예(DESIGN 3절)
def({
  name: "miku set", description: "하츠네 미쿠 + 대표 의상 또는 교복(선택지 안의 참조)", categories: [C.char],
  items: [text("miku", `${tag("hatsune_miku")}, ${tag("vocaloid")}, ${tag("twintails")}, ${tag("aqua_hair")}, {detached sleeves, necktie|${W("school uniform")}}`)],
});
def({
  name: "reimu set", description: "하쿠레이 레이무 + 신사 또는 자연", categories: [C.char],
  items: [text("reimu", `${tag("hakurei_reimu")}, ${tag("touhou")}, red bow, detached sleeves, {${tag("hakurei_shrine", true)}|${W("nature")}}`)],
});
def({
  name: "kaga set", description: "괄호가 든 캐릭터 태그 예시", categories: [C.char],
  items: [text("kaga", `${tag("kaga_(kancolle)")}, ${tag("kantai_collection")}, ${tag("side_ponytail")}`)],
});
const chars = mat("character").slice(0, 15);
const cw = weights(chars);
def({
  name: "character pool", description: "캐릭터 세트 셋과 인기 캐릭터 15명", categories: [C.char],
  items: [ref("miku set", 4), ref("reimu set", 4), ref("kaga set", 2), ...chars.map((m) => text(m.name, tag(m.name), cw(m)))],
});
def({ name: "subject", description: "오리지널 여자 캐릭터 또는 캐릭터 풀", categories: [C.preset], items: [ref("girl base", 3), ref("character pool", 2)] });

const special = mat("special");
def({
  name: "emoticon test", description: "특수문자(| \\ 괄호)와 짧은 이모티콘 태그. 이스케이프 검사용", categories: [C.etc], count: [1, 3],
  items: [
    ...special.map((m) => text(m.name, tag(m.name))),
    text("choice-with-pipes", `{${tag("\\||/", true)}|${tag("<|>_<|>", true)}|${tag(":|", true)}}`, 3),
  ],
});
def({
  name: "scene preset", description: "장면 프리셋: 품질 + 인물 + 의상 + 액세서리 + 표정 + 자세 + 카메라 + 장소 + 분위기", categories: [C.preset],
  items: [text("scene", ["quality", "subject", "outfit", "accessories", "expression", "pose", "camera", "location", "atmosphere"].map(W).join(", "))],
});

// ---------------------------------------------------------------- 문서로

const names = new Set<string>();
for (const d of defs) {
  if (names.has(d.name)) throw new Error(`이름 중복: ${d.name}`);
  names.add(d.name);
}

function toDoc(d: WcDef) {
  const used = new Set<string>();
  const items = d.items.map((it) => {
    let id = "";
    for (let k = 0; !id || used.has(id); k++) id = b62(`${d.name}\u0000${it.key}\u0000${k}`, 4);
    used.add(id);
    const out: Record<string, unknown> = { id };
    if (it.ref !== undefined) {
      if (!names.has(it.ref)) throw new Error(`${d.name}: 없는 참조 ${it.ref}`);
      out.ref = { wildcard: wcId(it.ref) };
      if (it.spread) out.spread = true;
    } else out.text = it.text;
    if (it.w !== undefined && it.w !== 1) out.w = it.w;
    return out;
  });
  const doc: Record<string, unknown> = { schema: 1, name: d.name, description: d.description };
  if (d.count || d.sep !== undefined) doc.select = { ...(d.count ? { count: d.count } : {}), ...(d.sep !== undefined ? { sep: d.sep } : {}) };
  doc.items = items;
  return doc;
}

const wildcards = defs.map((d) => ({ id: wcId(d.name), name: d.name, description: d.description, categories: d.categories, doc: toDoc(d) }));
const byId = new Map(wildcards.map((w) => [w.id, w]));

// 루트에서 닿는 와일드카드만 모은 닫힌 묶음. 해시 자리에는 와일드카드 ID를 그대로 쓴다(전개기는 해시를 검증하지 않음, SPEC 3.2).
function bundle(rootName: string) {
  const seen = new Set<string>();
  const stack = [wcId(rootName)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const doc = byId.get(id)!.doc as { items: { text?: string; ref?: { wildcard: string } }[] };
    for (const it of doc.items) {
      if (it.ref) stack.push(it.ref.wildcard);
      for (const m of (it.text ?? "").matchAll(/\$\{w:([0-9A-Za-z]{12})\}/g)) stack.push(m[1]);
    }
  }
  const ids = [...seen].sort();
  return {
    format: 1,
    root: wcId(rootName),
    lock: Object.fromEntries(ids.map((id) => [id, id])),
    docs: Object.fromEntries(ids.map((id) => [id, byId.get(id)!.doc])),
  };
}

mkdirSync(OUT, { recursive: true });
const write = (f: string, v: unknown) => writeFileSync(new URL(f, OUT), JSON.stringify(v, null, 2) + "\n");
write("examples.json", { format: "wakaaka-examples/1", owner: OWNER, wildcards });
const roots = ["scene preset", "emoticon test", "outfit", "accessories"];
write("bundles.json", Object.fromEntries(roots.map((r) => [r, bundle(r)])));
// 이스케이프 왕복 검사용: 재료 태그 전부를 바깥/선택지 안 두 맥락으로
write("escape-roundtrip.json", Object.values(mats).flat().flatMap((m) => [false, true].map((inChoice) => ({ name: m.name, prompt: promptTag(m.name), inChoice, text: escapeText(promptTag(m.name), inChoice) }))));
console.log(`wildcards ${wildcards.length}, items ${wildcards.reduce((a, w) => a + (w.doc.items as unknown[]).length, 0)}, bundles ${roots.length} → fixtures/out/`);
