// 나만 보는 폴더 (DESIGN 11절 "폴더", 사용자 결정 2026-11-08): 한 단계, 와일드카드마다 폴더 하나, 소유자 검사,
// 지우면 "폴더 없음"으로, 새 버전 없음, 가져온 복사본은 "폴더 없음", 공개 응답에는 폴더 정보가 없다.

import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdmin } from "../src/admincli.ts";
import { createDb } from "../src/db/connect.ts";
import { migrations } from "../src/db/migrations.ts";
import { FOLDER_MAX, MOVE_MAX } from "../src/services/folders.ts";
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

const one = (name: string, text = "x") => doc(name, [{ id: "a", text }]);

async function folder(c: Client, name: string, after?: string): Promise<string> {
  const r = await c.post("/api/folders", after === undefined ? { name } : { name, after });
  if (r.status !== 201) throw new Error(`folder failed: ${r.status} ${r.text}`);
  return r.body.id as string;
}
async function move(c: Client, folderId: string | null, wildcards: string[]) {
  return c.post("/api/folders/move", { folder: folderId, wildcards });
}
async function folderOf(id: string): Promise<string | null> {
  const r = await env.db.selectFrom("wildcard").select("folder_id").where("id", "=", id).executeTakeFirstOrThrow();
  return r.folder_id;
}
async function admin(...argv: string[]) {
  const out: string[] = [];
  await runAdmin(env.db, argv, (l) => out.push(l));
  return out;
}

describe("만들기, 목록, 이름 바꾸기, 지우기", () => {
  it("폴더는 만든 자리 순서(after가 없으면 맨 끝)이고 든 와일드카드 ID를 이름순으로 준다", async () => {
    const z = await alice.create(one("zeta"));
    const a = await alice.create(one("Alpha"));
    const m = await alice.create(one("mid"));
    const fb = await folder(alice, "배경");
    const fa = await folder(alice, "Apple");
    expect((await alice.get("/api/folders")).body).toEqual({
      folders: [
        { id: fb, name: "배경", wildcards: [] },
        { id: fa, name: "Apple", wildcards: [] },
      ],
    });
    expect((await move(alice, fb, [z, a])).body).toEqual({ folder: fb, moved: 2 });
    const l = (await alice.get("/api/folders")).body.folders;
    expect(l[0]).toEqual({ id: fb, name: "배경", wildcards: [a, z] });
    expect(await folderOf(m)).toBeNull();
  });

  it("만들면 201, 이름 바꾸기, 지우기", async () => {
    const r = await alice.post("/api/folders", { name: "캐릭터" });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: expect.stringMatching(/^[0-9A-Za-z]{12}$/), name: "캐릭터", wildcards: [] });
    const id = r.body.id;
    expect((await alice.put(`/api/folders/${id}`, { name: "인물" })).body).toEqual({ id, name: "인물" });
    // 자기 이름으로 바꾸기, 대소문자만 바꾸기는 된다
    expect((await alice.put(`/api/folders/${id}`, { name: "인물" })).status).toBe(200);
    const e = await folder(alice, "etc");
    expect((await alice.put(`/api/folders/${e}`, { name: "ETC" })).body.name).toBe("ETC");
    expect((await alice.del(`/api/folders/${id}`)).body).toEqual({ ok: true, moved: 0 });
    expect((await alice.get("/api/folders")).body.folders.map((f: any) => f.name)).toEqual(["ETC"]);
    expect((await alice.del(`/api/folders/${id}`)).status).toBe(404);
  });

  it("폴더를 지우면 든 와일드카드는 지우지 않고 '폴더 없음'으로 간다", async () => {
    const f = await folder(alice, "f");
    const x = await alice.create(one("x"));
    const y = await alice.create(one("y"));
    const gone = await alice.create(one("gone"));
    await move(alice, f, [x, y, gone]);
    await alice.del(`/api/wildcards/${gone}`);
    // 옮긴 개수는 지우지 않은 것만
    expect((await alice.del(`/api/folders/${f}`)).body).toEqual({ ok: true, moved: 2 });
    expect(await folderOf(x)).toBeNull();
    expect(await folderOf(gone)).toBeNull();
    expect((await alice.get("/api/wildcards")).body.wildcards.map((w: any) => w.name)).toEqual(["x", "y"]);
    expect((await alice.get(`/api/wildcards/${x}`)).status).toBe(200);
  });
});

describe("만드는 자리 (after, 0008)", () => {
  const names = async (c: Client) => (await c.get("/api/folders")).body.folders.map((f: any) => f.name);
  const positions = async () => (await env.db.selectFrom("wc_folder").select(["name", "position"]).orderBy("position").execute()).map((r) => `${r.name}:${r.position}`);

  it("after가 있으면 그 폴더 바로 다음, 없으면 맨 끝. 첫째·가운데·마지막 다음 모두", async () => {
    const a = await folder(alice, "a");
    const c = await folder(alice, "c");
    await folder(alice, "b", a);
    expect(await names(alice)).toEqual(["a", "b", "c"]);
    await folder(alice, "d", c); // 마지막 다음 = 맨 끝
    await folder(alice, "a2", a);
    await folder(alice, "end");
    expect(await names(alice)).toEqual(["a", "a2", "b", "c", "d", "end"]);
    // 뒤 폴더만 한 칸씩 밀린다. 번호는 사용자 안에서 겹치지 않는다
    expect(await positions()).toEqual(["a:0", "a2:1", "b:2", "c:3", "d:4", "end:5"]);
  });

  it("지운 자리의 빈 번호가 있어도 순서가 맞다. 다른 사용자의 순서와는 따로다", async () => {
    const a = await folder(alice, "a");
    const b = await folder(alice, "b");
    await folder(alice, "c");
    await alice.del(`/api/folders/${b}`);
    await folder(alice, "x", a);
    await folder(alice, "y");
    expect(await names(alice)).toEqual(["a", "x", "c", "y"]);
    const bob1 = await folder(bob, "b1");
    await folder(bob, "b0", bob1);
    expect(await names(bob)).toEqual(["b1", "b0"]);
    expect(await names(alice)).toEqual(["a", "x", "c", "y"]);
  });

  it("남의 폴더·없는 폴더·형식이 틀린 after는 404이고 아무것도 만들지 않는다. 문자열이 아니면 400", async () => {
    const mine = await folder(alice, "mine");
    const theirs = await folder(bob, "theirs");
    for (const after of [theirs, "AAAAAAAAAAAA", "short", ""]) {
      const r = await alice.post("/api/folders", { name: "n", after });
      expect(r.status, after).toBe(404);
      expect(r.body.error.code).toBe("E_FOLDER_NOT_FOUND");
    }
    for (const after of [null, 1, [mine]]) expect((await alice.post("/api/folders", { name: "n", after })).status).toBe(400);
    expect(await names(alice)).toEqual(["mine"]);
    expect(await names(bob)).toEqual(["theirs"]);
  });

  it("이름이 겹쳐 409이면 뒤 폴더도 밀리지 않는다(한 트랜잭션)", async () => {
    const a = await folder(alice, "a");
    await folder(alice, "b");
    const r = await alice.post("/api/folders", { name: "B", after: a });
    expect(r.status).toBe(409);
    expect(await positions()).toEqual(["a:0", "b:1"]);
  });

  it("동시에 같은 자리에 만들어도 번호가 겹치지 않는다", async () => {
    const a = await folder(alice, "a");
    await folder(alice, "z");
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => alice.post("/api/folders", { name: `n${i}`, after: a })));
    expect(rs.map((r) => r.status)).toEqual(Array(6).fill(201));
    const ps = (await env.db.selectFrom("wc_folder").select("position").execute()).map((r) => r.position).sort((x, y) => x - y);
    expect(ps).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const n = await names(alice);
    expect(n[0]).toBe("a");
    expect(n.at(-1)).toBe("z");
  });

  it("0008은 기존 폴더에 그때 보이던 순서(ORDER BY name, id) 그대로 번호를 매긴다", async () => {
    // 0007까지만 올린 스키마에 폴더를 넣고 0008을 올린다
    const schema = "t_" + randomBytes(6).toString("hex");
    const admin = createDb(TEST_DATABASE_URL, { max: 1 });
    await sql`create schema ${sql.id(schema)}`.execute(admin);
    await admin.destroy();
    const db = createDb(TEST_DATABASE_URL, { searchPath: schema, max: 2 });
    try {
      const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema });
      const r7 = await migrator.migrateTo("0007_folders");
      expect(r7.error).toBeUndefined();
      const owner = async (username: string) => (await sql<{ id: string }>`insert into owner (username, pw_hash) values (${username}, 'x') returning id`.execute(db)).rows[0]!.id;
      const o1 = await owner("o1");
      const o2 = await owner("o2");
      // 대소문자·한글·숫자·기호가 섞인 이름. 만든 순서는 일부러 뒤섞는다
      const seed: Array<[string, string, string]> = [
        ["Zzzzzzzzzzz1", o1, "zeta"],
        ["Aaaaaaaaaaa1", o1, "배경"],
        ["Mmmmmmmmmmm1", o1, "Alpha"],
        ["Bbbbbbbbbbb1", o1, "alpha2"],
        ["Ccccccccccc1", o1, "10 숫자"],
        ["Ddddddddddd1", o1, "_기호"],
        ["Eeeeeeeeeee1", o2, "b"],
        ["Fffffffffff1", o2, "a"],
      ];
      for (const [id, o, name] of seed) await sql`insert into wc_folder (id, owner_id, name) values (${id}, ${o}, ${name})`.execute(db);
      // 0007 코드의 listFolders와 같은 쿼리
      const before = async (o: string) => (await sql<{ id: string }>`select id from wc_folder where owner_id = ${o} order by name, id`.execute(db)).rows.map((r) => r.id);
      const b1 = await before(o1);
      const b2 = await before(o2);
      const r8 = await migrator.migrateToLatest();
      expect(r8.error).toBeUndefined();
      expect(r8.results?.map((r: { migrationName: string }) => r.migrationName)).toContain("0008_folder_position");
      const after = async (o: string) => db.selectFrom("wc_folder").select(["id", "position"]).where("owner_id", "=", o).orderBy("position").execute();
      const a1 = await after(o1);
      const a2 = await after(o2);
      expect(a1.map((r) => r.id)).toEqual(b1);
      expect(a2.map((r) => r.id)).toEqual(b2);
      expect(a1.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(a2.map((r) => r.position)).toEqual([0, 1]);
      // NOT NULL, 사용자 안 유일(커밋 때 검사)
      await expect(sql`insert into wc_folder (id, owner_id, name) values ('Ggggggggggg1', ${o1}, 'n')`.execute(db)).rejects.toMatchObject({ code: "23502" });
      await expect(sql`insert into wc_folder (id, owner_id, name, position) values ('Ggggggggggg1', ${o1}, 'n', 0)`.execute(db)).rejects.toMatchObject({ code: "23505" });
      expect((await sql`insert into wc_folder (id, owner_id, name, position) values ('Ggggggggggg1', ${o2}, 'n', 2)`.execute(db)).numAffectedRows).toBe(1n);
    } finally {
      await db.destroy();
    }
  });
});

describe("이름 규칙과 상한", () => {
  it("빈 이름, 앞뒤 공백, 65자, 제어문자, 짝 없는 서로게이트는 400", async () => {
    for (const name of ["", " a", "a ", "\ta", "a\nb", "a\u0000b", "a\u0001", "a\u007f", "\ud800", "x".repeat(65)]) {
      const r = await alice.post("/api/folders", { name });
      expect(r.status, JSON.stringify(name)).toBe(400);
      expect(r.body.error.code).toBe("E_FOLDER_NAME");
    }
    // 코드 포인트로 센다. 와일드카드 이름 금지 글자는 폴더에서는 된다
    for (const name of ["😀".repeat(64), "a b", "{ } $ \\ | = :", "x".repeat(64)]) expect((await alice.post("/api/folders", { name })).status, name).toBe(201);
    expect((await alice.get("/api/folders")).body.folders).toHaveLength(4);
  });

  it("본문은 엄격 스키마: 모르는 필드, 문자열이 아닌 이름은 400", async () => {
    expect((await alice.post("/api/folders", { name: "a", owner: "bob" })).body.error.code).toBe("E_SCHEMA");
    expect((await alice.post("/api/folders", { name: 3 })).body.error.code).toBe("E_SCHEMA");
    expect((await alice.post("/api/folders", { name: "a", id: "AAAAAAAAAAAA" })).body.error.code).toBe("E_SCHEMA");
  });

  it("같은 사용자 안에서 대소문자 무시로 겹치면 409. 다른 사용자는 같은 이름을 쓸 수 있다", async () => {
    await folder(alice, "Chars");
    const r = await alice.post("/api/folders", { name: "chars" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("E_FOLDER_NAME_TAKEN");
    const other = await folder(alice, "other");
    expect((await alice.put(`/api/folders/${other}`, { name: "CHARS" })).status).toBe(409);
    expect((await bob.post("/api/folders", { name: "chars" })).status).toBe(201);
  });

  it(`사용자당 ${FOLDER_MAX}개까지`, async () => {
    const owner = await env.db.selectFrom("owner").select("id").where("username", "=", "alice").executeTakeFirstOrThrow();
    await env.db
      .insertInto("wc_folder")
      .values(Array.from({ length: FOLDER_MAX - 1 }, (_, i) => ({ id: ("f" + String(i).padStart(11, "0")).slice(0, 12), owner_id: owner.id, name: `f${i}`, position: i })))
      .execute();
    expect((await alice.post("/api/folders", { name: "last" })).status).toBe(201);
    const r = await alice.post("/api/folders", { name: "over" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("E_FOLDER_LIMIT");
    expect((await bob.post("/api/folders", { name: "over" })).status).toBe(201);
  });

  it(`한 번에 ${MOVE_MAX}개까지 옮긴다. 빈 목록, 형식이 틀린 ID는 400`, async () => {
    const f = await folder(alice, "f");
    expect((await move(alice, f, [])).status).toBe(400);
    expect((await move(alice, f, ["short"])).status).toBe(400);
    expect((await move(alice, f, Array(MOVE_MAX + 1).fill("AAAAAAAAAAAA"))).status).toBe(400);
    expect((await alice.post("/api/folders/move", { folder: f })).status).toBe(400);
    expect((await alice.post("/api/folders/move", { folder: "bad", wildcards: ["AAAAAAAAAAAA"] })).status).toBe(400);
  });
});

describe("옮기기", () => {
  it("와일드카드는 폴더 하나에만 있다. 다른 폴더로 옮기면 앞 폴더에서 빠지고, null이면 '폴더 없음'", async () => {
    const f1 = await folder(alice, "f1");
    const f2 = await folder(alice, "f2");
    const x = await alice.create(one("x"));
    await move(alice, f1, [x]);
    await move(alice, f2, [x, x]); // 겹친 ID는 한 번
    expect((await alice.get("/api/folders")).body.folders.map((f: any) => f.wildcards)).toEqual([[], [x]]);
    expect((await move(alice, null, [x])).body).toEqual({ folder: null, moved: 1 });
    expect(await folderOf(x)).toBeNull();
  });

  it("없거나 지운 와일드카드가 하나라도 있으면 404이고 아무것도 옮기지 않는다", async () => {
    const f = await folder(alice, "f");
    const x = await alice.create(one("x"));
    const gone = await alice.create(one("gone"));
    await alice.del(`/api/wildcards/${gone}`);
    for (const extra of [gone, "AAAAAAAAAAAA"]) {
      const r = await move(alice, f, [x, extra]);
      expect(r.status).toBe(404);
      expect(r.body.error).toMatchObject({ code: "E_NOT_FOUND", wildcards: [extra] });
    }
    expect(await folderOf(x)).toBeNull();
    expect((await move(alice, "AAAAAAAAAAAA", [x])).body.error.code).toBe("E_FOLDER_NOT_FOUND");
  });

  it("폴더를 옮겨도 새 버전이 생기지 않고 해시·updatedAt·예시·둘러보기가 그대로다", async () => {
    const sub = await alice.create(one("sub", "red hair"));
    const top = await alice.create(doc("top", [{ id: "t", text: `1girl, ${W(sub)}` }]), [4]);
    const before = {
      top: (await alice.get(`/api/wildcards/${top}`)).text,
      versions: (await alice.get(`/api/wildcards/${top}/versions`)).text,
      recent: (await new Client(env).get("/api/explore?sort=recent")).text,
      bundle: (await new Client(env).get(`/api/w/${top}/bundle`)).text,
      contents: await env.db.selectFrom("wc_content").select("hash").orderBy("hash").execute(),
    };
    const f = await folder(alice, "f");
    await move(alice, f, [sub, top]);
    await move(alice, null, [sub]);
    expect((await alice.get(`/api/wildcards/${top}`)).text).toBe(before.top);
    expect((await alice.get(`/api/wildcards/${top}/versions`)).text).toBe(before.versions);
    expect((await new Client(env).get("/api/explore?sort=recent")).text).toBe(before.recent);
    expect((await new Client(env).get(`/api/w/${top}/bundle`)).text).toBe(before.bundle);
    expect(await env.db.selectFrom("wc_content").select("hash").orderBy("hash").execute()).toEqual(before.contents);
  });

  it("새 버전을 저장해도 폴더는 그대로다", async () => {
    const f = await folder(alice, "f");
    const x = await alice.create(one("x"));
    await move(alice, f, [x]);
    expect((await alice.put(`/api/wildcards/${x}`, { doc: one("x2", "y"), categories: [3] })).body.seq).toBe(2);
    expect(await folderOf(x)).toBe(f);
  });
});

describe("소유자 검사", () => {
  it("로그인하지 않으면 401", async () => {
    const anon = new Client(env);
    const f = await folder(alice, "f");
    expect((await anon.get("/api/folders")).status).toBe(401);
    expect((await anon.post("/api/folders", { name: "a" })).status).toBe(401);
    expect((await anon.put(`/api/folders/${f}`, { name: "a" })).status).toBe(401);
    expect((await anon.del(`/api/folders/${f}`)).status).toBe(401);
    expect((await move(anon, f, ["AAAAAAAAAAAA"])).status).toBe(401);
  });

  it("남의 폴더는 보이지 않고, 이름 바꾸기·지우기·넣기 모두 없는 것과 같은 404", async () => {
    const af = await folder(alice, "alice only");
    const ax = await alice.create(one("ax"));
    await move(alice, af, [ax]);
    const bx = await bob.create(one("bx"));
    expect((await bob.get("/api/folders")).body).toEqual({ folders: [] });
    for (const r of [await bob.put(`/api/folders/${af}`, { name: "mine" }), await bob.del(`/api/folders/${af}`), await move(bob, af, [bx])]) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("E_FOLDER_NOT_FOUND");
    }
    expect(await folderOf(bx)).toBeNull();
    expect((await alice.get("/api/folders")).body.folders).toEqual([{ id: af, name: "alice only", wildcards: [ax] }]);
  });

  it("남의 와일드카드는 내 폴더로도 '폴더 없음'으로도 옮길 수 없다(403). 섞여 있으면 아무것도 옮기지 않는다", async () => {
    const af = await folder(alice, "a");
    const bf = await folder(bob, "b");
    const ax = await alice.create(one("ax"));
    const bx = await bob.create(one("bx"));
    await move(bob, bf, [bx]);
    for (const r of [await move(alice, af, [bx]), await move(alice, null, [bx]), await move(alice, af, [ax, bx])]) {
      expect(r.status).toBe(403);
      expect(r.body.error).toMatchObject({ code: "E_FORBIDDEN", wildcards: [bx] });
    }
    expect(await folderOf(ax)).toBeNull();
    expect(await folderOf(bx)).toBe(bf);
  });

  it("DB도 남의 폴더에 넣는 것을 막는다(복합 FK)", async () => {
    const bf = await folder(bob, "b");
    const ax = await alice.create(one("ax"));
    const e = await env.db
      .updateTable("wildcard")
      .set({ folder_id: bf })
      .where("id", "=", ax)
      .execute()
      .then(
        () => null,
        (x: unknown) => x as { code?: string; constraint?: string },
      );
    expect(e).toMatchObject({ code: "23503", constraint: "wildcard_folder_fk" });
  });
});

describe("폴더 정보는 나만 본다", () => {
  it("내 목록, 조회, 둘러보기, 사용자별 목록, lookup, 즐겨찾기, 노드 API에 폴더가 나오지 않는다", async () => {
    const x = await alice.create(one("x", "red hair"), [4]);
    const fid = await folder(alice, "비밀폴더이름");
    const before: Record<string, string> = {};
    const paths = (c: Client, who: string): Array<[string, () => Promise<{ text: string }>]> => [
      [`${who} mine`, () => c.get("/api/wildcards")],
      [`${who} get`, () => c.get(`/api/wildcards/${x}`)],
      [`${who} explore`, () => c.get("/api/explore")],
      [`${who} user`, () => c.get("/api/users/alice/wildcards")],
      [`${who} lookup`, () => c.post("/api/lookup", { ids: [x] })],
      [`${who} favorites`, () => c.get("/api/favorites")],
      [`${who} bundle`, () => c.get(`/api/w/${x}/bundle`)],
      [`${who} meta`, () => c.get(`/api/w/${x}/meta`)],
      [`${who} resolve`, () => c.get(`/api/w/${x}/resolve?seed=3`)],
      [`${who} export`, () => c.get(`/api/w/${x}/export?format=impact`)],
    ];
    await bob.post("/api/favorites", { wildcard: x });
    const all = [...paths(alice, "alice"), ...paths(bob, "bob"), ...paths(new Client(env), "anon")];
    for (const [k, f] of all) before[k] = (await f()).text;
    await move(alice, fid, [x]);
    for (const [k, f] of all) {
      const t = (await f()).text;
      expect(t, k).toBe(before[k]);
      expect(t, k).not.toContain(fid);
      expect(t, k).not.toContain("비밀폴더이름");
      expect(t, k).not.toMatch(/folder/i);
    }
  });
});

describe("가져오기, 삭제, 관리", () => {
  it("가져오기로 만든 복사본은 '폴더 없음'에 들어가고, 다시 쓴 복사본은 있던 폴더에 남는다", async () => {
    const sub = await bob.create(one("sub", "cat ears"));
    const pool = await bob.create(doc("pool", [{ id: "p", text: `1girl, ${W(sub)}` }]));
    const f = await folder(alice, "가져온 것");
    const r1 = (await alice.post(`/api/wildcards/${sub}/import`)).body;
    await move(alice, f, [r1.root]);
    const r2 = (await alice.post(`/api/wildcards/${pool}/import`)).body;
    expect(r2.reused.map((x: any) => x.id)).toEqual([r1.root]);
    expect(await folderOf(r2.root)).toBeNull();
    expect(await folderOf(r1.root)).toBe(f);
    // 새로 만든 것도 "폴더 없음"
    expect(await folderOf(await alice.create(one("new")))).toBeNull();
  });

  it("지운 와일드카드는 폴더 목록에서 빠지고, 관리자가 되살리면 원래 폴더로 돌아간다", async () => {
    const f = await folder(alice, "f");
    const x = await alice.create(one("x"));
    const y = await alice.create(one("y"));
    await move(alice, f, [x, y]);
    await alice.del(`/api/wildcards/${x}`);
    expect((await alice.get("/api/folders")).body.folders[0].wildcards).toEqual([y]);
    await admin("restore-wildcard", x, "--yes");
    expect((await alice.get("/api/folders")).body.folders[0].wildcards).toEqual([x, y]);

    // 관리자 강제 삭제도 같다. 그 사이 폴더를 지웠으면 "폴더 없음"으로 돌아온다
    await admin("delete-wildcard", y, "--yes");
    expect((await alice.get("/api/folders")).body.folders[0].wildcards).toEqual([x]);
    await alice.del(`/api/folders/${f}`);
    await admin("restore-wildcard", y, "--yes");
    expect(await folderOf(y)).toBeNull();
    expect((await alice.get("/api/folders")).body.folders).toEqual([]);
  });

  it("계정을 지우면 폴더도 지운다", async () => {
    const f = await folder(alice, "f");
    await folder(alice, "g");
    const x = await alice.create(one("x"));
    await move(alice, f, [x]);
    const bf = await folder(bob, "bob keeps");
    expect((await admin("delete-account", "alice"))[0]).toBe("would delete account alice: wildcards 1, sessions 1, favorites 0, likes given 0, folders 2");
    expect(await env.db.selectFrom("wc_folder").select("id").execute()).toHaveLength(3);
    await admin("delete-account", "alice", "--yes");
    expect((await env.db.selectFrom("wc_folder").select("id").execute()).map((r) => r.id)).toEqual([bf]);
    expect(await folderOf(x)).toBeNull();
  });
});
