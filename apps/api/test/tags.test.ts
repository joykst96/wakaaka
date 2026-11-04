// Phase 5 API: 태그 가져오기(다시 돌리기, 데이터 버전), 자동완성(영문·한국어), 이름 조회 (DESIGN 6절, 7절 "태그 자동완성").
// 실제 CSV(11.4만 행)는 WAKAAKA_TAGS_CSV를 줄 때만 맨 아래 테스트가 읽는다.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importTags } from "../src/services/tags.ts";
import { Client, setupEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let anon: Client;
beforeEach(async () => {
  env = await setupEnv();
  anon = new Client(env);
});
afterEach(async () => {
  await env.close();
});

const enc = (s: string) => new TextEncoder().encode(s);
const csv = (lines: string[]) => enc(["name,category,post_count,description", ...lines].join("\r\n") + "\r\n");

const BASE = [
  'long_hair,0,5000,"[머리카락 > 머리 길이] 어깨를 넘는 긴 머리카락. 키워드: 긴머리, 장발"',
  'very_long_hair,0,1500,"[머리카락 > 머리 길이] 아주 긴 머리카락. 키워드: 아주 긴 머리"',
  'hair_ornament,0,3000,"[액세서리 > 머리장식] 머리 장식. 키워드: 머리장식, 헤어 액세서리"',
  'hair_bow,0,2000,"[액세서리 > 머리장식] 머리 리본. 키워드: 머리 리본"',
  'hatsune_miku,4,1300,"[캐릭터 > 보컬로이드/버추얼] 보컬로이드 캐릭터. 키워드: 하츠네 미쿠, 미쿠"',
  'nakano_miku,4,900,"[캐릭터 > 애니/만화] 오등분의 신부. 키워드: 나카노 미쿠, 미쿠"',
  'black_hair,0,4000,"[머리카락 > 머리 색상] 검은 머리카락. 키워드: 흑발, 검은 머리"',
  'cat_ears,0,2500,"[동물/생물 > 동물 부위] 고양이 귀. 키워드: 고양이 귀, 냥이 귀"',
  'cat,0,800,"[동물/생물 > 동물] 고양이. 키워드: 고양이"',
  '100%_orange_juice,3,700,"[작품/출처 > 게임] 게임. 키워드: 100% 오렌지 주스"',
  "a_b,0,600,[사물 > 기타 사물] 백분율 _ 기호. 키워드: 기호",
  "^_^,0,1000,[표정/감정 > 표정] 웃는 얼굴. 키워드: 웃음",
  "dintoge,1,99,,",
  "voymastina_(girls'_frontline_2),4,99,An android.,威玛西娜|보이마스티나(소녀전선2)",
  "hatsune_miku_(append),4,98,,",
];

async function load(lines = BASE, force = false) {
  return importTags(env.db, { fileName: "tags.csv", bytes: csv(lines), force });
}
const suggest = (q: string) => anon.get(`/api/tags/suggest?q=${encodeURIComponent(q)}`);
const names = async (q: string) => {
  const r = await suggest(q);
  expect(r.status).toBe(200);
  return r.body.tags.map((t: { name: string }) => t.name);
};

describe("가져오기", () => {
  it("넣은 행, 키워드·별명 배열, 데이터 버전", async () => {
    const r = await load();
    expect(r).toMatchObject({ skipped: false, rows: 15, columns: ["name", "category", "post_count", "description"] });
    expect(r.stats).toEqual({ rows: 15, extraColumnRows: 3, withKeywords: 12, withOtherNames: 1, keywordRows: expect.any(Number) });
    const tag = await env.db.selectFrom("tag").selectAll().where("name", "=", "hatsune_miku").executeTakeFirstOrThrow();
    expect(tag).toMatchObject({ category: 4, post_count: 1300, body: "보컬로이드 캐릭터.", keywords: ["하츠네 미쿠", "미쿠"], other_names: [], major_category: null, name_key: "hatsunemiku", is_deprecated: false });
    const empty = await env.db.selectFrom("tag").select(["keywords", "other_names", "description", "body"]).where("name", "=", "dintoge").executeTakeFirstOrThrow();
    expect(empty).toEqual({ keywords: [], other_names: [], description: "", body: "" });
    const voy = await env.db.selectFrom("tag").select(["other_names", "ko_text"]).where("name", "=", "voymastina_(girls'_frontline_2)").executeTakeFirstOrThrow();
    expect(voy).toEqual({ other_names: ["威玛西娜", "보이마스티나(소녀전선2)"], ko_text: "보이마스티나(소녀전선2)" });
    const v = await env.db.selectFrom("tag_import").selectAll().execute();
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file_name: "tags.csv", file_sha256: createHash("sha256").update(csv(BASE)).digest("hex"), row_count: 15, file_size: String(csv(BASE).length) });
    expect(await env.db.selectFrom("tag_alias").selectAll().execute()).toEqual([]);
  });

  it("같은 파일은 건너뛰고, --force는 다시 넣고, 다른 파일은 통째로 바꾼다", async () => {
    await load();
    const ids = await env.db.selectFrom("tag").select("id").execute();
    expect((await load()).skipped).toBe(true);
    expect(await env.db.selectFrom("tag_import").select("id").execute()).toHaveLength(1);
    expect(await env.db.selectFrom("tag").select("id").execute()).toEqual(ids);

    const f = await load(BASE, true);
    expect(f.skipped).toBe(false);
    expect(await env.db.selectFrom("tag_import").select("id").execute()).toHaveLength(2);
    expect(await env.db.selectFrom("tag").select("name").execute()).toHaveLength(15);

    await load(['long_hair,0,10,"[a > b] 긴. 키워드: 장발"', "new_tag,0,5,"]);
    expect((await env.db.selectFrom("tag").select("name").orderBy("name").execute()).map((x) => x.name)).toEqual(["long_hair", "new_tag"]);
    const kw = await env.db.selectFrom("tag_keyword").select(["key", "kind"]).execute();
    expect(kw).toEqual([{ key: "장발", kind: 0 }]);
    expect(await names("hair")).toEqual(["long_hair"]);
  });

  it("CSV가 틀리면 아무것도 바꾸지 않는다 (트랜잭션)", async () => {
    await load();
    await expect(load([...BASE.slice(0, 3), "broken,9,1,"])).rejects.toThrow(/line 5: bad category 9/);
    await expect(importTags(env.db, { fileName: "x.csv", bytes: new Uint8Array([0x6e, 0x61, 0xff]) })).rejects.toThrow(TypeError);
    expect(await env.db.selectFrom("tag").select("id").execute()).toHaveLength(15);
    expect(await env.db.selectFrom("tag_import").select("id").execute()).toHaveLength(1);
  });

  it("넣는 도중 실패하면 되돌린다", async () => {
    await load();
    // 실패를 DB 쪽에서 만든다: tag_import 삽입이 실패하도록 열 제약을 하나 건다
    await sql`alter table tag_import add constraint no_more check (id < 0) not valid`.execute(env.db);
    await expect(load(["x,0,1,"])).rejects.toThrow(/no_more/);
    expect(await env.db.selectFrom("tag").select("id").execute()).toHaveLength(15);
  });
});

describe("자동완성: 영문", () => {
  beforeEach(async () => {
    await load();
  });

  it("이름 키 접두 일치를 post_count 순으로, 밑줄·공백·대소문자 무시", async () => {
    // 접두(hair_ornament, hair_bow) 다음에 부분 일치(long_hair, black_hair, very_long_hair), 각각 post_count 순
    expect(await names("hair")).toEqual(["hair_ornament", "hair_bow", "long_hair", "black_hair", "very_long_hair"]);
    for (const q of ["long h", "long_h", "LONGH", " longha "]) expect(await names(q)).toEqual(["long_hair", "very_long_hair"]);
    expect(await names("hatsune m")).toEqual(["hatsune_miku", "hatsune_miku_(append)"]);
  });

  it("부분 일치는 3글자부터, 접두 일치 뒤에", async () => {
    expect(await names("mi")).toEqual([]);
    expect(await names("miku")).toEqual(["hatsune_miku", "nakano_miku", "hatsune_miku_(append)"]);
    expect(await names("ai")).toEqual([]);
    expect(await names("air")).toEqual(["long_hair", "black_hair", "hair_ornament", "hair_bow", "very_long_hair"]);
  });

  it("LIKE 특수문자는 글자로", async () => {
    expect(await names("100%")).toEqual(["100%_orange_juice"]);
    expect(await names("%")).toEqual([]);
    expect(await names("_")).toEqual([]);
    expect(await names("\\")).toEqual([]);
    expect(await names("^_")).toEqual(["^_^"]);
    expect(await names("a_")).toEqual(["a_b"]);
  });

  it("응답 모양과 개수 상한", async () => {
    const r = await suggest("long");
    expect(r.body.tags[0]).toEqual({ name: "long_hair", category: 0, postCount: 5000, body: "어깨를 넘는 긴 머리카락.", keywords: ["긴머리", "장발"] });
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await load(Array.from({ length: 30 }, (_, i) => `tag_${i},0,${100 + i},`), true);
    const many = await names("tag");
    expect(many).toHaveLength(20);
    expect(many[0]).toBe("tag_29");
  });
});

describe("자동완성: 한국어", () => {
  beforeEach(async () => {
    await load();
  });

  it("키워드 전체가 같음 → 키워드 접두 → 낱말 접두 → 부분 일치, 같은 단계는 post_count 순", async () => {
    // '머리'(2글자): 키워드 접두(머리장식, 머리 리본=머리리본)와 낱말 접두('검은 머리', '아주 긴 머리'의 낱말 '머리')만. 본문은 보지 않는다
    expect(await names("머리")).toEqual(["hair_ornament", "hair_bow", "black_hair", "very_long_hair"]);
    // '머리카락'(4글자): 키워드에는 없고 본문 부분 일치
    expect(await names("머리카락")).toEqual(["long_hair", "black_hair", "very_long_hair"]);
    expect(await names("미쿠")).toEqual(["hatsune_miku", "nakano_miku"]);
    expect(await names("고양이")).toEqual(["cat", "cat_ears"]);
  });

  it("공백 무시, 1글자, 한글 other_names", async () => {
    for (const q of ["긴머리", "긴 머리", " 긴  머리 "]) expect((await names(q))[0]).toBe("long_hair");
    expect(await names("하츠네미쿠")).toEqual(["hatsune_miku"]);
    expect(await names("고양이귀")).toEqual(["cat_ears"]);
    expect(await names("흑")).toEqual(["black_hair"]);
    expect(await names("보이마스")).toEqual(["voymastina_(girls'_frontline_2)"]);
  });

  it("LIKE 특수문자는 글자로 (키워드와 본문)", async () => {
    expect(await names("백분율 _")).toEqual(["a_b"]);
    expect(await names("백분율 %")).toEqual([]);
    expect(await names("100% 오렌")).toEqual(["100%_orange_juice"]);
    expect(await names("100_ 오렌")).toEqual([]);
  });
});

describe("자동완성: 입력 검증", () => {
  it("q 필수, 모르는 매개변수, 길이, 문자열 검사, 공백뿐", async () => {
    expect((await anon.get("/api/tags/suggest")).status).toBe(400);
    expect((await anon.get("/api/tags/suggest?q=a&limit=5")).status).toBe(400);
    expect((await suggest("a".repeat(64))).status).toBe(200);
    expect((await suggest("a".repeat(65))).body.error.code).toBe("E_QUERY");
    expect((await suggest("가".repeat(65))).status).toBe(400);
    expect((await suggest("a\u0000b")).status).toBe(400);
    expect((await suggest("a\u0007b")).status).toBe(400);
    expect((await suggest("   ")).body).toEqual({ tags: [] });
  });

  it("SQL 문자열은 데이터로만", async () => {
    await load();
    for (const q of ["'; drop table tag; --", "긴'); drop table tag; --", "\\'", "%' or '1'='1"]) expect((await suggest(q)).status).toBe(200);
    expect(await env.db.selectFrom("tag").select("id").execute()).toHaveLength(15);
  });
});

describe("이름 조회 (표기 lint용)", () => {
  beforeEach(async () => {
    await load();
  });
  it("있는 것만, 이름 순", async () => {
    const r = await anon.post("/api/tags/lookup", { names: ["long_hair", "nope", "^_^", "long_hair", "Long_hair"] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ tags: { "^_^": { category: 0, postCount: 1000 }, long_hair: { category: 0, postCount: 5000 } } });
  });
  it("__proto__ 이름, 개수·크기 상한, 스키마, SQL 문자열", async () => {
    await load(["__proto__,0,1,", "constructor,0,2,"], true);
    const r = await anon.post("/api/tags/lookup", { names: ["__proto__", "constructor"] });
    expect(r.text).toBe('{"tags":{"__proto__":{"category":0,"postCount":1},"constructor":{"category":0,"postCount":2}}}');
    expect(({} as Record<string, unknown>).category).toBeUndefined();
    expect((await anon.post("/api/tags/lookup", { names: Array(201).fill("a") })).status).toBe(400);
    expect((await anon.post("/api/tags/lookup", { names: [""] })).status).toBe(400);
    expect((await anon.post("/api/tags/lookup", { names: ["a"], extra: 1 })).status).toBe(400);
    expect((await anon.post("/api/tags/lookup", { names: ["a\u0000"] })).status).toBe(400);
    expect((await anon.request("POST", "/api/tags/lookup", undefined, { raw: JSON.stringify({ names: ["x".repeat(70_000)] }) })).status).toBe(413);
    expect((await anon.request("POST", "/api/tags/lookup", undefined, { raw: '{"names":["a"]}', contentType: "text/plain" })).status).toBe(415);
    expect((await anon.post("/api/tags/lookup", { names: ["'); drop table tag; --"] })).body).toEqual({ tags: {} });
    expect(await env.db.selectFrom("tag").select("id").execute()).toHaveLength(2);
  });
});

const REAL = process.env.WAKAAKA_TAGS_CSV;
describe.runIf(REAL !== undefined && existsSync(REAL))("실제 danbooru-tags.csv", () => {
  it("행 수, 다섯째 열, 키워드, 검색", { timeout: 120_000 }, async () => {
    const bytes = readFileSync(REAL!);
    const r = await importTags(env.db, { fileName: "danbooru-tags.csv", bytes });
    expect(r.rows).toBe(114_092);
    expect(r.stats).toMatchObject({ rows: 114_092, extraColumnRows: 42_947, withKeywords: 71_142, withOtherNames: 13_426 });
    const cats = await sql<{ category: number; n: string }>`select category, count(*) n from tag group by 1 order by 1`.execute(env.db);
    expect(cats.rows.map((x) => [x.category, Number(x.n)])).toEqual([[0, 29_023], [1, 44_018], [3, 7_758], [4, 32_819], [5, 474]]);
    expect((await names("long h"))[0]).toBe("long_hair");
    expect((await names("긴 머리"))[0]).toBe("long_hair");
    expect((await names("미쿠"))[0]).toBe("hatsune_miku");
    expect((await names("교복"))[0]).toBe("school_uniform");
  });
});
