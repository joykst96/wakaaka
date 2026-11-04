// 운영 기본 와일드카드 생성기 (DESIGN 10절 "기본 와일드카드", fixtures/tools/build-defaults.ts).
// 합성 CSV로 묶는 규칙을 보고, 실제 danbooru-tags.csv가 있으면 전부 일반 저장 경로(seedExamples)로 넣어 본다.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expand } from "@wakaaka/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDefaults } from "../../../fixtures/tools/build-defaults.ts";
import { seedExamples } from "../src/services/seed.ts";
import { Client, setupEnv, type TestEnv } from "./helpers.ts";

// 없으면 저장소 옆 폴더 danbooru-tag/의 CSV. 둘 다 없으면 이 묶음은 건너뛴다
const REAL_CSV = process.env.WAKAAKA_TAGS_CSV ?? fileURLToPath(new URL("../../../../danbooru-tag/danbooru-tags.csv", import.meta.url));

function csv(rows: Array<[string, number, number, string]>): string {
  const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return "name,category,post_count,description\n" + rows.map(([n, c, p, d]) => [q(n), c, p, q(d)].join(",")).join("\n") + "\n";
}

type W = { name: string; categories: number[]; doc: { name: string; description: string; select: unknown; items: Array<{ id: string; text: string; w?: number }> } };
const byName = (r: ReturnType<typeof buildDefaults>) => new Map((r.examples.wildcards as W[]).map((w) => [w.name, w]));

describe("묶는 규칙 (합성 CSV)", () => {
  const artists = Array.from({ length: 12_001 }, (_, i) => [`artist_${i}`, 1, 100_000 - i, "[아티스트 > 개인] 작가 키워드: 작가"] as [string, number, number, string]);
  const rows: Array<[string, number, number, string]> = [
    ["long_hair", 0, 5000, "[머리카락 > 머리 길이] 긴 머리 키워드: 긴 머리"],
    ["short_hair", 0, 9000, "[머리카락 > 머리 길이] 짧은 머리"],
    ["sex", 0, 8000, "[행동 > 성적행위] 성행위 키워드: 섹스"],
    ["nipples", 0, 7000, "[신체 > 신체 부위] 젖꼭지"],
    ["no_korean", 0, 99999, "[사물 > 기타 사물] only english"], // 분류 표시만 한글
    ["no_bracket", 0, 99999, "한글은 있지만 분류 표시가 없음"],
    ["english_wiki", 3, 99999, "A game. Korean title: 체인즈 오브 파워"],
    ["hatsune_miku", 4, 100, "[캐릭터 > 보컬로이드/버추얼] 하츠네 미쿠"],
    ["ayanami_rei", 4, 200, "[캐릭터 > 애니/만화] 아야나미 레이"],
    ["highres", 5, 1000, "[메타 > 해상도] 고해상도"],
    ["^_^", 0, 10, "[표정/감정 > 웃음] 웃는 얼굴"],
    ["{brace}|pipe", 0, 5, "[사물 > 기타 사물] 특수문자 시험"],
    ["kantai_collection", 3, 300, "[작품/출처 > 게임] 칸코레"],
    ...artists,
  ];
  const r = buildDefaults(csv(rows), "test.csv");
  const m = byName(r);

  it("한글 설명 + [대분류 > 소분류]만, NSFW는 거르지 않는다", () => {
    expect(r.used).toBe(rows.length - 3);
    const all = [...m.values()].flatMap((w) => w.doc.items.map((i) => i.text));
    expect(all).toContain("sex");
    expect(all).toContain("nipples");
    for (const t of ["no korean", "no bracket", "english wiki"]) expect(all).not.toContain(t);
  });

  it("일반 태그는 소분류마다, 이름은 '대분류 > 소분류', 항목은 post_count 순·가중치 없음·개수 1~1", () => {
    const w = m.get("머리카락 > 머리 길이")!;
    expect(w.doc.items.map((i) => i.text)).toEqual(["short hair", "long hair"]);
    expect(w.doc.items.every((i) => i.w === undefined)).toBe(true);
    expect(w.doc.select).toEqual({ count: [1, 1], sep: ", " });
    expect(w.categories).toEqual([4]);
    expect(w.doc.description).toMatch(/^Danbooru 일반 태그 \[머리카락 > 머리 길이\] 2개 중 하나/);
    expect(m.get("행동 > 성적행위")!.categories).toEqual([7]);
  });

  it("그 밖의 분류는 소분류를 보지 않고 post_count 순 5,000개씩", () => {
    expect([...m.keys()].filter((n) => n.startsWith("아티스트"))).toEqual(["아티스트 1", "아티스트 2", "아티스트 3"]);
    expect(m.get("아티스트 1")!.doc.items).toHaveLength(5000);
    expect(m.get("아티스트 1")!.doc.items[0]!.text).toBe("artist 0");
    expect(m.get("아티스트 2")!.doc.items[0]!.text).toBe("artist 5000");
    expect(m.get("아티스트 3")!.doc.items).toHaveLength(2001);
    expect(m.get("아티스트 3")!.doc.items.at(-1)!.text).toBe("artist 12000");
    expect(m.get("아티스트 3")!.doc.description).toMatch(/12,001개 중 post_count 순 10,001~12,001번째/);
    // 캐릭터는 보컬로이드·애니가 한 와일드카드에(소분류 무시), post_count 순
    expect(m.get("캐릭터 1")!.doc.items.map((i) => i.text)).toEqual(["ayanami rei", "hatsune miku"]);
    expect(m.get("작품/출처 1")!.doc.items.map((i) => i.text)).toEqual(["kantai collection"]);
    expect(m.get("메타 1")!.categories).toEqual([13]);
    expect([...m.keys()].some((n) => n.startsWith("캐릭터 >"))).toBe(false);
  });

  it("표기: 자동완성과 같은 변환과 이스케이프, 이모티콘 밑줄은 그대로", () => {
    const texts = [...m.values()].flatMap((w) => w.doc.items.map((i) => i.text));
    expect(texts).toContain("^_^");
    expect(texts).toContain("\\{brace\\}|pipe"); // 선택지 밖이라 |는 그대로
  });

  it("다시 만들면 같다(ID 포함)", () => {
    expect(buildDefaults(csv(rows), "test.csv").examples).toEqual(r.examples);
    const ids = m.get("아티스트 1")!.doc.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.skipIf(!existsSync(REAL_CSV))("실제 danbooru-tags.csv 전부를 일반 저장 경로로", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("115개, 태그 71,142개, 모두 저장되고 전개된다", { timeout: 300_000 }, async () => {
    const r = buildDefaults(readFileSync(REAL_CSV, "utf8"), "danbooru-tags.csv");
    expect(r.examples.wildcards).toHaveLength(115);
    expect(r.used).toBe(71_142);
    const names = await seedExamples(env.db, r.examples);
    expect(names.size).toBe(115);
    const anon = new Client(env);
    const list = await anon.get("/api/users/wakaaka/wildcards");
    expect(list.body.wildcards).toHaveLength(115);
    let items = 0;
    for (const [name, id] of names) {
      const b = await anon.get(`/api/w/${id}/bundle`);
      expect(b.status, name).toBe(200);
      items += (Object.values(b.body.docs)[0] as { items: unknown[] }).items.length;
      for (const seed of ["0", "1", "18446744073709551615"]) {
        const e = expand(b.body, seed);
        expect(e.ok && e.text.length > 0, `${name} seed ${seed}`).toBe(true);
      }
    }
    expect(items).toBe(71_142);
    // 둘러보기에 나오고(원본이므로) 예시 출력이 있다
    const ex = await anon.get("/api/explore?sort=recent&q=%EC%95%84%ED%8B%B0%EC%8A%A4%ED%8A%B8");
    // 일반 태그인데 설명 대분류가 아티스트인 것(서클 등)은 "아티스트 > …"로 따로 있다
    expect(ex.body.wildcards.map((w: { name: string }) => w.name).filter((n: string) => /^아티스트 [0-9]+$/.test(n)).sort()).toEqual(["아티스트 1", "아티스트 2", "아티스트 3", "아티스트 4", "아티스트 5"]);
    expect(ex.body.wildcards.every((w: { example: string | null }) => typeof w.example === "string" && w.example.length > 0)).toBe(true);
  });
});
