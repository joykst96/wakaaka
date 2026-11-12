// 성인 분류 14 (DESIGN 3절, 10절 "기본 와일드카드", 사용자 요청 2026-11-12): 저장·둘러보기에서 쓸 수 있고,
// 0010 마이그레이션이 이미 넣은 기본 와일드카드(wakaaka 계정의 `성인 > `)에 14를 더한다.

import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/connect.ts";
import { migrations } from "../src/db/migrations.ts";
import { Client, doc, setupEnv, TEST_DATABASE_URL, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let alice: Client;
beforeEach(async () => {
  env = await setupEnv();
  alice = await new Client(env).signup("alice");
});
afterEach(async () => {
  await env.close();
});

const one = (name: string) => doc(name, [{ id: "a", text: name }]);
const names = (r: { body: { wildcards: Array<{ name: string }> } }) => r.body.wildcards.map((w) => w.name).sort();

describe("성인 분류 14", () => {
  it("저장과 수정에 쓸 수 있고 15는 거부한다", async () => {
    const id = await alice.create(one("a"), [14, 11]);
    expect((await alice.get(`/api/wildcards/${id}`)).body.categories).toEqual([11, 14]);
    expect((await alice.put(`/api/wildcards/${id}`, { doc: one("a"), categories: [14] })).status).toBe(200);
    expect((await alice.get(`/api/wildcards/${id}`)).body.categories).toEqual([14]);
    const bad = await alice.post("/api/wildcards", { doc: one("b"), categories: [15] });
    expect(bad.status).toBe(400);
  });

  it("둘러보기 cat=14로 거르고, 1~14를 한꺼번에 줄 수 있다", async () => {
    await alice.create(one("adult"), [11, 14]);
    await alice.create(one("scene"), [11]);
    await alice.create(one("none"));
    expect(names(await alice.get("/api/explore?cat=14"))).toEqual(["adult"]);
    expect(names(await alice.get("/api/explore?cat=11"))).toEqual(["adult", "scene"]);
    const all = await alice.get("/api/explore?cat=" + Array.from({ length: 14 }, (_, i) => i + 1).join(","));
    expect(all.status).toBe(200);
    expect(names(all)).toEqual(["adult", "scene"]);
    expect((await alice.get("/api/explore?cat=" + Array.from({ length: 15 }, () => 1).join(","))).status).toBe(400);
  });
});

describe("0010 마이그레이션", () => {
  it("wakaaka 계정의 `성인 > `에만 14를 더한다(지운 것 포함, 다시 돌려도 같다)", async () => {
    const schema = "t_" + randomBytes(6).toString("hex");
    const admin = createDb(TEST_DATABASE_URL, { max: 1 });
    await sql`create schema ${sql.id(schema)}`.execute(admin);
    await admin.destroy();
    const db = createDb(TEST_DATABASE_URL, { searchPath: schema, max: 2 });
    try {
      const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema });
      expect((await migrator.migrateTo("0009_fixed")).error).toBeUndefined();
      const owner = async (u: string) => (await sql<{ id: string }>`insert into owner (username, pw_hash) values (${u}, 'x') returning id`.execute(db)).rows[0]!.id;
      const w = await owner("Wakaaka"); // 이름 비교는 대소문자 무시
      const other = await owner("bob");
      const rows: Array<[string, string, string, number[], boolean]> = [
        ["000000000001", w, "성인 > 노출", [11], false],
        ["000000000002", w, "성인 > 체액", [11], true],
        ["000000000003", w, "성인 > 기타", [11, 14], false],
        ["000000000004", w, "성인 > 자위", [], false],
        ["000000000005", w, "의상 > 수영복", [6], false],
        ["000000000006", w, "성인>붙여쓴 이름", [11], false],
        ["000000000007", other, "성인 > 노출", [11], false],
      ];
      for (const [id, o, name, cats, deleted] of rows)
        await sql`insert into wildcard (id, owner_id, name, latest_seq, categories, deleted_at)
                  values (${id}, ${o}, ${name}, 1, ${cats}::smallint[], ${deleted ? sql`now()` : null})`.execute(db);
      const r = await migrator.migrateToLatest();
      expect(r.error).toBeUndefined();
      expect(r.results?.map((x: { migrationName: string }) => x.migrationName)).toContain("0010_adult_category");
      const want: Record<string, number[]> = {
        "000000000001": [11, 14],
        "000000000002": [11, 14],
        "000000000003": [11, 14],
        "000000000004": [14],
        "000000000005": [6],
        "000000000006": [11],
        "000000000007": [11],
      };
      const read = async () => Object.fromEntries((await db.selectFrom("wildcard").select(["id", "categories"]).orderBy("id").execute()).map((x) => [x.id, x.categories]));
      expect(await read()).toEqual(want);
      await migrations["0010_adult_category"]!.up(db);
      expect(await read()).toEqual(want);
    } finally {
      await db.destroy();
    }
  }, 60_000);
});
