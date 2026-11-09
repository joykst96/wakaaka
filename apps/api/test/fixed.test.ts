// 고정 표시 (DESIGN 3절 "고정 표시"): 저장할 때 계산해 목록·카드에 내고, 0009 마이그레이션이 이미 있는 행을 채운다.

import { randomBytes } from "node:crypto";
import { isFixedDoc, type Doc } from "@wakaaka/core";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/connect.ts";
import { migrations } from "../src/db/migrations.ts";
import { Client, doc, setupEnv, TEST_DATABASE_URL, W, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  env = await setupEnv();
  alice = await new Client(env).signup("alice");
  bob = await new Client(env).signup("bob");
});
afterEach(async () => {
  await env.close();
});

const fixedOf = async (c: Client, id: string) => {
  const one = (await c.get(`/api/wildcards/${id}`)).body.fixed;
  const mine = (await c.get("/api/wildcards")).body.wildcards.find((w: { id: string }) => w.id === id)?.fixed;
  expect(mine).toBe(one);
  return one as boolean;
};

describe("저장할 때 계산", () => {
  it("만들 때, 새 버전마다 최신 버전을 따른다", async () => {
    const id = await alice.create(doc("miku", [{ id: "a", text: "hatsune miku, aqua hair" }]));
    expect(await fixedOf(alice, id)).toBe(true);
    await alice.put(`/api/wildcards/${id}`, { doc: doc("miku", [{ id: "a", text: "hatsune miku, {smile|grin}" }]) });
    expect(await fixedOf(alice, id)).toBe(false);
    // 주석 항목을 더해도 고정
    await alice.put(`/api/wildcards/${id}`, { doc: doc("miku", [{ id: "c", text: "# 메모" }, { id: "a", text: "hatsune miku" }]) });
    expect(await fixedOf(alice, id)).toBe(true);
    // 분류만 바꾸면(새 버전 없음) 그대로
    await alice.put(`/api/wildcards/${id}`, { doc: doc("miku", [{ id: "c", text: "# 메모" }, { id: "a", text: "hatsune miku" }]), categories: [1] });
    expect(await fixedOf(alice, id)).toBe(true);
    await alice.put(`/api/wildcards/${id}`, { doc: doc("miku", [{ id: "a", text: "hatsune miku" }], { select: { count: [0, 1], sep: ", " } }) });
    expect(await fixedOf(alice, id)).toBe(false);
  });

  it("참조가 있으면 대상이 고정이어도 고정이 아니다", async () => {
    const leaf = await alice.create(doc("leaf", [{ id: "a", text: "x" }]));
    const inline = await alice.create(doc("inline", [{ id: "a", text: "y, " + W(leaf) }]));
    const refItem = await alice.create(doc("ref", [{ id: "a", ref: { wildcard: leaf } }]));
    expect(await fixedOf(alice, leaf)).toBe(true);
    expect(await fixedOf(alice, inline)).toBe(false);
    expect(await fixedOf(alice, refItem)).toBe(false);
  });

  it("둘러보기·사용자 페이지 카드와 가져온 복사본", async () => {
    const f = await bob.create(doc("fixed one", [{ id: "a", text: "x" }]));
    const r = await bob.create(doc("random one", [{ id: "a", text: "x" }, { id: "b", text: "y" }]));
    const anon = new Client(env);
    const cards = (await anon.get("/api/explore")).body.wildcards as Array<{ id: string; fixed: boolean }>;
    expect(cards.find((c) => c.id === f)?.fixed).toBe(true);
    expect(cards.find((c) => c.id === r)?.fixed).toBe(false);
    const user = (await anon.get("/api/users/bob/wildcards")).body.wildcards as Array<{ id: string; fixed: boolean }>;
    expect(user.find((c) => c.id === f)?.fixed).toBe(true);
    const imp = await alice.post(`/api/wildcards/${f}/import`);
    expect(imp.status).toBe(201);
    expect(await fixedOf(alice, imp.body.created[0].id)).toBe(true);
  });
});

describe("둘러보기 fixed 필터", () => {
  it("1은 고정만, 0은 고정 빼고, 없으면 전부. 검색·분류와 함께 쓴다", async () => {
    const f1 = await bob.create(doc("miku", [{ id: "a", text: "hatsune miku" }]), [1]);
    const f2 = await bob.create(doc("quality", [{ id: "a", text: "masterpiece" }]));
    const r1 = await bob.create(doc("miku outfit", [{ id: "a", text: "x" }, { id: "b", text: "y" }]), [1]);
    const anon = new Client(env);
    const ids = async (qs: string) => {
      const r = await anon.get("/api/explore" + qs);
      expect(r.status).toBe(200);
      return (r.body.wildcards as Array<{ id: string }>).map((w) => w.id).sort();
    };
    expect(await ids("")).toEqual([f1, f2, r1].sort());
    expect(await ids("?fixed=1")).toEqual([f1, f2].sort());
    expect(await ids("?fixed=0")).toEqual([r1]);
    expect(await ids("?fixed=1&q=miku")).toEqual([f1]);
    expect(await ids("?fixed=0&cat=1&sort=recent")).toEqual([r1]);
    // 새 버전으로 고정이 풀리면 고정만 목록에서 빠진다
    await bob.put(`/api/wildcards/${f2}`, { doc: doc("quality", [{ id: "a", text: "{masterpiece|best quality}" }]) });
    expect(await ids("?fixed=1")).toEqual([f1]);
  });

  it("다른 값은 400", async () => {
    const anon = new Client(env);
    for (const v of ["true", "2", "", "yes"]) {
      const r = await anon.get("/api/explore?fixed=" + v);
      expect([v, r.status, r.body.error?.code ?? r.body.code]).toEqual([v, 400, "E_QUERY"]);
    }
  });
});

describe("0009 마이그레이션", () => {
  it("이미 있는 행을 최신 버전 문서로 채운다(1,000개 넘게, 지운 것과 옛 버전 포함)", async () => {
    const schema = "t_" + randomBytes(6).toString("hex");
    const admin = createDb(TEST_DATABASE_URL, { max: 1 });
    await sql`create schema ${sql.id(schema)}`.execute(admin);
    await admin.destroy();
    const db = createDb(TEST_DATABASE_URL, { searchPath: schema, max: 2 });
    try {
      const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema });
      expect((await migrator.migrateTo("0008_folder_position")).error).toBeUndefined();
      const o = (await sql<{ id: string }>`insert into owner (username, pw_hash) values ('o', 'x') returning id`.execute(db)).rows[0]!.id;
      const kinds: Array<(n: number) => object> = [
        (n) => ({ schema: 1, name: "n" + n, items: [{ id: "a", text: "fixed " + n }] }),
        (n) => ({ schema: 1, name: "n" + n, items: [{ id: "a", text: "{a|b} " + n }] }),
        (n) => ({ schema: 1, name: "n" + n, items: [{ id: "c", text: "# c" }, { id: "a", text: "f " + n }], select: { count: [1, 1], sep: ", " } }),
        (n) => ({ schema: 1, name: "n" + n, items: [{ id: "a", text: "x" }, { id: "b", text: "y " + n }] }),
        (n) => ({ schema: 1, name: "n" + n, items: [{ id: "a", text: "z " + n }], select: { count: [0, 1], sep: ", " } }),
      ];
      const N = 1203;
      const want = new Map<string, boolean>();
      for (let n = 0; n < N; n++) {
        const id = n.toString().padStart(12, "0");
        const d = kinds[n % kinds.length]!(n);
        // 옛 버전 1은 반대 성격(고정 ↔ 선택지), 최신 버전 2가 판정 대상
        const old = { schema: 1, name: "n" + n, items: [{ id: "a", text: isFixedDoc(d as Doc) ? "{p|q}" : "plain" }] };
        const h1 = "o" + id.slice(1);
        const h2 = "h" + id.slice(1);
        await sql`insert into wc_content (hash, doc, size) values (${h1}, ${JSON.stringify(old)}::jsonb, 1), (${h2}, ${JSON.stringify(d)}::jsonb, 1)`.execute(db);
        await sql`insert into wildcard (id, owner_id, name, latest_seq, deleted_at) values (${id}, ${o}, ${"n" + n}, 2, ${n % 7 === 0 ? sql`now()` : null})`.execute(db);
        await sql`insert into wc_version (wildcard_id, seq, hash) values (${id}, 1, ${h1}), (${id}, 2, ${h2})`.execute(db);
        want.set(id, isFixedDoc(d as Doc));
      }
      const r = await migrator.migrateToLatest();
      expect(r.error).toBeUndefined();
      expect(r.results?.map((x: { migrationName: string }) => x.migrationName)).toContain("0009_fixed");
      const got = await db.selectFrom("wildcard").select(["id", "fixed"]).execute();
      expect(got).toHaveLength(N);
      for (const g of got) expect([g.id, g.fixed]).toEqual([g.id, want.get(g.id)]);
      // 고정·비고정이 둘 다 충분히 있다(판정 표가 한쪽으로 쏠리지 않았는지)
      const trues = got.filter((g) => g.fixed).length;
      expect(trues).toBeGreaterThan(400);
      expect(N - trues).toBeGreaterThan(400);
    } finally {
      await db.destroy();
    }
  }, 60_000);
});
