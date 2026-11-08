// 관리 CLI (DESIGN 9절 "관리", 사용자 결정 2026-11-04): 강제 삭제(같은 소유자의 참조하는 것까지), 계정 삭제, 되살리기.
// 웹·API에는 관리 권한이 없다. 인자는 ID·아이디 형식만 받고, 바꾸는 명령은 --yes가 없으면 아무것도 바꾸지 않는다.

import { expand } from "@wakaaka/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs, runAdmin } from "../src/admincli.ts";
import { AdminError } from "../src/services/admin.ts";
import { Client, doc, setupEnv, W, type TestEnv } from "./helpers.ts";

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

/** CLI를 돌리고 출력 줄을 돌려준다. 거부면 AdminError를 던진다 */
async function admin(...argv: string[]): Promise<string[]> {
  const out: string[] = [];
  await runAdmin(env.db, argv, (l) => out.push(l));
  return out;
}
async function refused(argv: string[], pattern: RegExp): Promise<void> {
  const e = await admin(...argv).then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, argv.join(" ")).toBeInstanceOf(AdminError);
  expect((e as Error).message).toMatch(pattern);
}

/** 바뀐 것이 없는지 보려고 DB 상태를 통째로 찍는다 */
async function snapshot() {
  const db = env.db;
  return {
    owners: await db.selectFrom("owner").select(["id", "username", "deleted_at"]).orderBy("id").execute(),
    wildcards: await db.selectFrom("wildcard").select(["id", "name", "deleted_at", "like_count"]).orderBy("id").execute(),
    sessions: await db.selectFrom("session").select(["token_hash"]).orderBy("token_hash").execute(),
    likes: await db.selectFrom("wc_like").select(["owner_id", "wildcard_id"]).orderBy("owner_id").orderBy("wildcard_id").execute(),
    favorites: await db.selectFrom("favorite").select(["owner_id", "wildcard_id"]).orderBy("owner_id").orderBy("wildcard_id").execute(),
  };
}

/** alice: base ← mid ← top, 그리고 따로 있는 solo. bob은 top을 가져간다(복사본 3개) */
async function fixture() {
  const base = await alice.create(doc("base", [{ id: "a", text: "red" }, { id: "b", text: "blue" }]));
  const mid = await alice.create(doc("mid", [{ id: "a", text: `${W(base)} hair` }]));
  const top = await alice.create(doc("top", [{ id: "a", text: `1girl, ${W(mid)}` }, { id: "b", text: "{x|y}" }]));
  const solo = await alice.create(doc("solo", [{ id: "a", text: "solo" }]));
  const imp = await bob.post(`/api/wildcards/${top}/import`);
  expect(imp.status).toBe(201);
  const bobTop = imp.body.created.find((x: { forkedFrom: { wildcard: string } }) => x.forkedFrom.wildcard === top).id as string;
  return { base, mid, top, solo, bobTop };
}

async function resolveText(c: Client, id: string, seed: number) {
  const r = await c.get(`/api/w/${id}/resolve?seed=${seed}`);
  return { status: r.status, text: r.body?.text as string | undefined };
}

describe("인자 해석: 모르는 것과 형식이 틀린 것은 거부", () => {
  it.each([
    [[], /usage/],
    [["help"], /usage/],
    [["drop-everything"], /unknown command/],
    [["delete-wildcard"], /wrong number/],
    [["delete-wildcard", "a", "b"], /wrong number/],
    [["show-account", "alice", "--yes"], /does not change/],
    [["delete-account", "alice", "--force"], /unknown option/],
    [["delete-account", "alice", "-y"], /unknown option/],
    [["restore-wildcard", "--yes"], /wrong number/],
  ])("%j", async (argv, pattern) => {
    expect(() => parseArgs(argv as string[])).toThrow(AdminError);
    await refused(argv as string[], pattern);
  });

  it.each([
    "'; drop table owner; --",
    "../../etc/passwd",
    "abc",
    "AAAAAAAAAAAA ",
    "AAAAAAAAAAA%",
    "ＡＡＡＡＡＡＡＡＡＡＡＡ",
    "AAAAAAAAAAAA\u0000",
  ])("와일드카드 ID %j", async (id) => {
    const before = await snapshot();
    for (const cmd of ["show-wildcard", "delete-wildcard", "restore-wildcard"]) await refused([cmd, id, ...(cmd === "show-wildcard" ? [] : ["--yes"])], /not a wildcard ID/);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["alice' or '1'='1", "al", "a".repeat(33), "alice\u0000", "ålice", "alice%", "%"])("아이디 %j", async (u) => {
    const before = await snapshot();
    await refused(["show-account", u], /not a username/);
    await refused(["delete-account", u, "--yes"], /not a username/);
    expect(await snapshot()).toEqual(before);
  });

  it("없는 것", async () => {
    await refused(["show-wildcard", "zzzzzzzzzzzz"], /no such wildcard/);
    await refused(["delete-wildcard", "zzzzzzzzzzzz", "--yes"], /no such wildcard/);
    await refused(["delete-account", "nobody", "--yes"], /no such account/);
  });

  it("API에는 관리 경로가 없다", async () => {
    for (const p of ["/api/admin", "/api/admin/wildcards/x", "/api/admin/delete-account"]) {
      expect((await alice.get(p)).status).toBe(404);
      expect((await alice.post(p, { username: "bob" })).status).toBe(404);
    }
  });
});

describe("와일드카드 강제 삭제", () => {
  it("드라이런은 아무것도 바꾸지 않고 함께 지울 목록을 보여 준다", async () => {
    const f = await fixture();
    const before = await snapshot();
    const out = await admin("delete-wildcard", f.base);
    expect(out[0]).toBe("would delete 3:");
    expect(out.slice(1, 4).map((l) => l.trim().split(/\s+/)[0])).toEqual([f.base, f.mid, f.top]);
    expect(out.at(-1)).toMatch(/dry run/);
    expect(await snapshot()).toEqual(before);
    expect((await alice.get(`/api/wildcards/${f.base}`)).status).toBe(200);
  });

  it("show-wildcard: 함께 지워질 것과 남는 복사본", async () => {
    const f = await fixture();
    const out = (await admin("show-wildcard", f.base)).join("\n");
    expect(out).toMatch(/referenced by \(deleted together on delete-wildcard\): 2/);
    expect(out).toContain(f.mid);
    expect(out).toContain(f.top);
    expect(out).toMatch(/copies by others \(kept\): 1/);
  });

  it("일반 삭제는 409인 것을 참조하는 것까지 지운다. 다른 계정의 복사본과 상관없는 것은 그대로", async () => {
    const f = await fixture();
    expect((await alice.del(`/api/wildcards/${f.base}`)).status).toBe(409);
    const bobBefore = await Promise.all([0, 1, 2, 3, 4].map((s) => resolveText(bob, f.bobTop, s)));
    const aliceBefore = await Promise.all([0, 1, 2, 3, 4].map((s) => resolveText(bob, f.top, s)));
    expect(bobBefore).toEqual(aliceBefore);

    const out = await admin("delete-wildcard", f.base, "--yes");
    expect(out[0]).toBe("deleted 3:");
    expect(out.at(-1)).toBe("done");
    for (const id of [f.base, f.mid, f.top]) {
      expect((await bob.get(`/api/wildcards/${id}`)).status).toBe(404);
      expect((await bob.get(`/api/w/${id}/bundle`)).status).toBe(404);
      expect((await bob.get(`/api/w/${id}/meta`)).status).toBe(404);
      expect((await bob.get(`/api/w/${id}/resolve?seed=0`)).status).toBe(404);
    }
    expect((await alice.get(`/api/wildcards/${f.solo}`)).status).toBe(200);
    // bob의 복사본은 bob의 것이라 그대로, 결과도 같다
    expect(await Promise.all([0, 1, 2, 3, 4].map((s) => resolveText(bob, f.bobTop, s)))).toEqual(bobBefore);
    const mine = await alice.get("/api/wildcards");
    expect(mine.body.wildcards.map((w: { name: string }) => w.name)).toEqual(["solo"]);
    // 이미 지운 것
    await refused(["delete-wildcard", f.base, "--yes"], /already deleted/);
    // 같은 이름은 다시 쓸 수 있다(일반 삭제와 같음)
    await alice.create(doc("base", [{ id: "a", text: "new" }]));
  });

  it("가운데를 지우면 위쪽만 함께, 아래쪽은 남는다", async () => {
    const f = await fixture();
    const out = await admin("delete-wildcard", f.mid, "--yes");
    expect(out[0]).toBe("deleted 2:");
    expect((await alice.get(`/api/wildcards/${f.base}`)).status).toBe(200);
    expect((await alice.get(`/api/w/${f.base}/bundle`)).status).toBe(200);
    expect((await alice.get(`/api/wildcards/${f.top}`)).status).toBe(404);
  });

  it("남의 와일드카드도 지운다(소유자 확인 없음 = 서버 접근이 권한)", async () => {
    const f = await fixture();
    await admin("delete-wildcard", f.bobTop, "--yes");
    expect((await bob.get(`/api/wildcards/${f.bobTop}`)).status).toBe(404);
    // bob의 하위 복사본은 bobTop이 참조하던 것이라 남는다
    expect((await bob.get("/api/wildcards")).body.wildcards.length).toBe(2);
  });
});

describe("되살리기", () => {
  it("함께 지운 것은 함께 되살린다. 하나만 되살리면 거부", async () => {
    const f = await fixture();
    const before = await Promise.all([0, 1, 2, 3].map((s) => resolveText(alice, f.top, s)));
    const del = await admin("delete-wildcard", f.base, "--yes");
    const hint = del.find((l) => l.startsWith("restore: "))!;
    expect(hint).toBe(`restore: node apps/api/src/admin.ts restore-wildcard ${f.base} ${f.mid} ${f.top} --yes`);

    const snap = await snapshot();
    await refused(["restore-wildcard", f.top, "--yes"], new RegExp(`restore them together: ${f.mid}`));
    await refused(["restore-wildcard", f.top, f.mid, "--yes"], new RegExp(`restore them together: ${f.base}`));
    expect(await snapshot()).toEqual(snap);

    // 아래쪽만은 된다(최신 버전 참조가 모두 살아 있음)
    expect((await admin("restore-wildcard", f.base))[0]).toBe("would restore 1:");
    expect(await snapshot()).toEqual(snap);
    const out = await admin("restore-wildcard", f.top, f.base, f.mid, f.top, "--yes");
    expect(out[0]).toBe("restored 3:");
    expect(await Promise.all([0, 1, 2, 3].map((s) => resolveText(alice, f.top, s)))).toEqual(before);
    const b = await alice.get(`/api/w/${f.top}/bundle`);
    expect(expand(b.body, "0").ok).toBe(true);
  });

  it("거부: 지우지 않은 것, 이름을 다시 쓴 것, 소유자가 섞인 것", async () => {
    const f = await fixture();
    await refused(["restore-wildcard", f.solo, "--yes"], /not deleted/);
    await admin("delete-wildcard", f.solo, "--yes");
    await alice.create(doc("SOLO", [{ id: "a", text: "again" }]));
    await refused(["restore-wildcard", f.solo, "--yes"], /is used again by alice/);
    await admin("delete-wildcard", f.bobTop, "--yes");
    await refused(["restore-wildcard", f.solo, f.bobTop, "--yes"], /same account/);
  });

  it("거부: 준 것끼리 이름이 겹침", async () => {
    const a = await alice.create(doc("dup", [{ id: "a", text: "1" }]));
    await admin("delete-wildcard", a, "--yes");
    const b = await alice.create(doc("Dup", [{ id: "a", text: "2" }]));
    await admin("delete-wildcard", b, "--yes");
    await refused(["restore-wildcard", a, b, "--yes"], /name collision among/);
    expect((await admin("restore-wildcard", b, "--yes"))[0]).toBe("restored 1:");
  });
});

describe("계정 삭제", () => {
  it("드라이런은 아무것도 바꾸지 않는다", async () => {
    await fixture();
    const before = await snapshot();
    const out = await admin("delete-account", "ALICE");
    expect(out[0]).toBe("would delete account alice: wildcards 4, sessions 1, favorites 0, likes given 0, folders 0");
    expect(await snapshot()).toEqual(before);
    expect((await alice.get("/api/me")).status).toBe(200);
  });

  it("와일드카드·세션·즐겨찾기·좋아요를 지우고, 로그인·가입·사용자 페이지를 막는다", async () => {
    const f = await fixture();
    const bobSolo = await bob.create(doc("bob solo", [{ id: "a", text: "x" }]));
    expect((await alice.put(`/api/wildcards/${bobSolo}/like`)).status).toBe(200);
    expect((await alice.post("/api/favorites", { wildcard: bobSolo })).status).toBe(201);
    expect((await bob.put(`/api/wildcards/${f.solo}/like`)).status).toBe(200);
    const alice2 = new Client(env);
    expect((await alice2.post("/api/auth/login", { username: "alice", password: "password123" })).status).toBe(200);
    const bobTopBefore = await Promise.all([0, 1, 2].map((s) => resolveText(bob, f.bobTop, s)));
    const likesBefore = (await env.db.selectFrom("wildcard").select("like_count").where("id", "=", bobSolo).executeTakeFirstOrThrow()).like_count;
    expect(likesBefore).toBe(1);

    const out = await admin("delete-account", "alice", "--yes");
    expect(out[0]).toBe("deleted account alice: wildcards 4, sessions 2, favorites 1, likes given 1, folders 0");

    for (const c of [alice, alice2]) expect((await c.get("/api/me")).status).toBe(401);
    // 쿠키를 그대로 들고 와도 쓰기는 401
    expect((await alice.post("/api/wildcards", { doc: doc("x", []) })).status).toBe(401);
    const login = await new Client(env).post("/api/auth/login", { username: "alice", password: "password123" });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("E_LOGIN");
    const again = await new Client(env).post("/api/auth/signup", { username: "Alice", password: "password123" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("E_USERNAME_TAKEN");
    expect((await bob.get("/api/users/alice/wildcards")).status).toBe(404);
    for (const id of [f.base, f.mid, f.top, f.solo]) expect((await bob.get(`/api/w/${id}/meta`)).status).toBe(404);
    const explore = await bob.get("/api/explore?sort=recent");
    expect(explore.body.wildcards.map((w: { owner: string }) => w.owner)).not.toContain("alice");

    const after = (await env.db.selectFrom("wildcard").select("like_count").where("id", "=", bobSolo).executeTakeFirstOrThrow()).like_count;
    expect(after).toBe(0);
    expect(await env.db.selectFrom("favorite").selectAll().execute()).toEqual([]);
    // bob이 가져간 복사본은 그대로
    expect(await Promise.all([0, 1, 2].map((s) => resolveText(bob, f.bobTop, s)))).toEqual(bobTopBefore);
    // bob은 영향 없음
    expect((await bob.get("/api/me")).status).toBe(200);
    expect((await bob.put(`/api/wildcards/${bobSolo}`, { doc: doc("bob solo", [{ id: "a", text: "y" }]) })).status).toBe(200);

    await refused(["delete-account", "alice", "--yes"], /already deleted/);
    await refused(["restore-wildcard", f.solo, "--yes"], /account is deleted/);
    expect((await admin("show-account", "alice"))[0]).toMatch(/DELETED/);
  });
});
