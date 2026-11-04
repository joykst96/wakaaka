// Phase 3 API: 즐겨찾기, 좋아요, 둘러보기, 여러 ID 조회, 사용자별 목록, 비밀번호 변경, 예시 출력 (DESIGN 7절, 11절).

import { expand } from "@wakaaka/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const item = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, text, ...extra });
const names = (r: { body: { wildcards: Array<{ name: string }> } }) => r.body.wildcards.map((w) => w.name);

describe("즐겨찾기", () => {
  it("남의 것만, 다시 넣어도 하나, 목록·삭제", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    const mine = await bob.create(doc("mine", [item("a", "x")]));

    expect((await bob.post("/api/favorites", { wildcard: mine })).body.error.code).toBe("E_FAVORITE_OWN");
    let r = await bob.post("/api/favorites", { wildcard: a });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ added: true, favorited: true });
    r = await bob.post("/api/favorites", { wildcard: a });
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(false);

    r = await bob.get("/api/favorites");
    expect(r.body.favorites.map((w: { id: string; owner: string; favorited: boolean }) => [w.id, w.owner, w.favorited])).toEqual([[a, "alice", true]]);
    expect((await alice.get("/api/favorites")).body.favorites).toEqual([]);

    expect((await bob.del(`/api/favorites/${a}`)).body).toEqual({ removed: true, favorited: false });
    expect((await bob.del(`/api/favorites/${a}`)).body.removed).toBe(false);
    expect((await bob.get("/api/favorites")).body.favorites).toEqual([]);
  });

  it("로그인 필요, 없는 것·형식이 틀린 ID는 404", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    const anon = new Client(env);
    expect((await anon.get("/api/favorites")).status).toBe(401);
    expect((await anon.post("/api/favorites", { wildcard: a })).status).toBe(401);
    expect((await bob.post("/api/favorites", { wildcard: "AAAAAAAAAAAA" })).status).toBe(404);
    expect((await bob.post("/api/favorites", { wildcard: "short" })).status).toBe(400);
    expect((await bob.del("/api/favorites/short")).status).toBe(404);
  });

  it("지운 와일드카드는 목록에서 빠진다", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    await bob.post("/api/favorites", { wildcard: a });
    expect((await alice.del(`/api/wildcards/${a}`)).status).toBe(200);
    expect((await bob.get("/api/favorites")).body.favorites).toEqual([]);
    expect((await bob.post("/api/favorites", { wildcard: a })).status).toBe(404);
  });
});

describe("좋아요", () => {
  it("계정당 한 번, 취소, like_count와 행 수가 같다", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    expect((await bob.put(`/api/wildcards/${a}/like`)).body).toEqual({ liked: true, likes: 1 });
    expect((await bob.put(`/api/wildcards/${a}/like`)).body).toEqual({ liked: true, likes: 1 });
    const carol = await new Client(env).signup("carol");
    expect((await carol.put(`/api/wildcards/${a}/like`)).body.likes).toBe(2);
    expect((await bob.del(`/api/wildcards/${a}/like`)).body).toEqual({ liked: false, likes: 1 });
    expect((await bob.del(`/api/wildcards/${a}/like`)).body).toEqual({ liked: false, likes: 1 });
    expect((await alice.get(`/api/wildcards/${a}`)).body.likes).toBe(1);
  });

  it("자기 것은 안 됨, 로그인 필요, 없는 것 404", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    const r = await alice.put(`/api/wildcards/${a}/like`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("E_LIKE_OWN");
    expect((await new Client(env).put(`/api/wildcards/${a}/like`)).status).toBe(401);
    expect((await bob.put("/api/wildcards/AAAAAAAAAAAA/like")).status).toBe(404);
  });

  it("동시에 눌러도 like_count = 행 수", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    const users = await Promise.all(["u01", "u02", "u03", "u04", "u05", "u06"].map((n) => new Client(env).signup(n)));
    await Promise.all(users.flatMap((u) => [u.put(`/api/wildcards/${a}/like`), u.put(`/api/wildcards/${a}/like`)]));
    await Promise.all(users.slice(0, 2).map((u) => u.del(`/api/wildcards/${a}/like`)));
    const rows = await env.db.selectFrom("wc_like").select("owner_id").where("wildcard_id", "=", a).execute();
    const w = await env.db.selectFrom("wildcard").select("like_count").where("id", "=", a).executeTakeFirstOrThrow();
    expect(rows.length).toBe(4);
    expect(w.like_count).toBe(4);
  });

  it("상세 조회에 보는 사람의 좋아요·즐겨찾기 여부가 붙는다", async () => {
    const a = await alice.create(doc("hair", [item("a", "red")]));
    await bob.put(`/api/wildcards/${a}/like`);
    expect((await bob.get(`/api/wildcards/${a}`)).body.viewer).toEqual({ liked: true, favorited: false });
    await bob.post("/api/favorites", { wildcard: a });
    expect((await bob.get(`/api/wildcards/${a}`)).body.viewer).toEqual({ liked: true, favorited: true });
    expect((await new Client(env).get(`/api/wildcards/${a}`)).body.viewer).toEqual({ liked: false, favorited: false });
  });
});

describe("둘러보기", () => {
  it("기본은 인기순, recent는 최신 버전 순, 로그인 없이", async () => {
    const x = await alice.create(doc("x", [item("a", "1")]));
    const y = await alice.create(doc("y", [item("a", "1")]));
    const z = await bob.create(doc("z", [item("a", "1")]));
    const carol = await new Client(env).signup("carol");
    await bob.put(`/api/wildcards/${y}/like`);
    await carol.put(`/api/wildcards/${y}/like`);
    await carol.put(`/api/wildcards/${z}/like`);
    const anon = new Client(env);
    expect(names(await anon.get("/api/explore"))).toEqual(["y", "z", "x"]);
    expect(names(await anon.get("/api/explore?sort=popular"))).toEqual(["y", "z", "x"]);
    // x를 새로 저장하면 최신순 맨 앞
    await alice.put(`/api/wildcards/${x}`, { doc: doc("x", [item("a", "2")]) });
    expect(names(await anon.get("/api/explore?sort=recent"))).toEqual(["x", "z", "y"]);
  });

  it("가져온 복사본과 지운 것은 나오지 않는다", async () => {
    const leaf = await alice.create(doc("leaf", [item("a", "1")]));
    const root = await alice.create(doc("root", [item("a", W(leaf))]));
    const gone = await alice.create(doc("gone", [item("a", "1")]));
    await alice.del(`/api/wildcards/${gone}`);
    expect((await bob.post(`/api/wildcards/${root}/import`)).status).toBe(201);
    expect((await bob.get("/api/wildcards")).body.wildcards).toHaveLength(2);
    expect(names(await bob.get("/api/explore?sort=recent")).sort()).toEqual(["leaf", "root"]);
  });

  it("q는 이름·설명에서 대소문자 무시 부분 일치", async () => {
    await alice.create(doc("Hair Color", [item("a", "1")]));
    await alice.create(doc("eyes", [item("a", "1")], { description: "눈 색 HAIR와 무관" }));
    await alice.create(doc("pose", [item("a", "1")]));
    expect(names(await alice.get("/api/explore?q=hair")).sort()).toEqual(["Hair Color", "eyes"]);
    expect(names(await alice.get("/api/explore?q=" + encodeURIComponent("눈 색")))).toEqual(["eyes"]);
    expect(names(await alice.get("/api/explore?q=%20%20"))).toHaveLength(3); // 공백뿐이면 검색 안 함
  });

  it("LIKE 특수문자는 글자 그대로 찾는다", async () => {
    await alice.create(doc("100% cotton", [item("a", "1")]));
    await alice.create(doc("snake_case", [item("a", "1")]));
    await alice.create(doc("plain", [item("a", "1")]));
    // 이름에는 \를 쓸 수 없으므로 설명에 둔다
    await alice.create(doc("abc", [item("a", "1")], { description: "x\\y" }));
    expect(names(await alice.get("/api/explore?q=" + encodeURIComponent("%")))).toEqual(["100% cotton"]);
    expect(names(await alice.get("/api/explore?q=_"))).toEqual(["snake_case"]);
    expect(names(await alice.get("/api/explore?q=" + encodeURIComponent("\\")))).toEqual(["abc"]);
    expect(names(await alice.get("/api/explore?q=" + encodeURIComponent("%%%")))).toEqual([]);
  });

  it("cat은 하나라도 겹치면", async () => {
    await alice.create(doc("a", [item("a", "1")]), [1, 4]);
    await alice.create(doc("b", [item("a", "1")]), [4]);
    await alice.create(doc("c", [item("a", "1")]), [7]);
    await alice.create(doc("d", [item("a", "1")]));
    expect(names(await alice.get("/api/explore?cat=4&sort=recent")).sort()).toEqual(["a", "b"]);
    expect(names(await alice.get("/api/explore?cat=1,7")).sort()).toEqual(["a", "c"]);
    expect(names(await alice.get("/api/explore?cat=13"))).toEqual([]);
  });

  it("쪽 나누기: 30개씩, nextOffset", async () => {
    for (let i = 0; i < 31; i++) await alice.create(doc(`w${String(i).padStart(2, "0")}`, [item("a", "1")]));
    const p1 = await alice.get("/api/explore");
    expect(p1.body.wildcards).toHaveLength(30);
    expect(p1.body.nextOffset).toBe(30);
    const p2 = await alice.get("/api/explore?offset=30");
    expect(p2.body.wildcards).toHaveLength(1);
    expect(p2.body.nextOffset).toBeNull();
    const all = new Set([...names(p1), ...names(p2)]);
    expect(all.size).toBe(31);
  });

  it("잘못된 쿼리는 400", async () => {
    for (const q of ["sort=hot", "sort=name", "sort=like_count%20desc", "cat=0", "cat=14", "cat=1;drop", "cat=", "offset=-1", "offset=10001", "offset=1e3", "page=2", "q=" + "a".repeat(101), "q=%00", "q=%1B"]) {
      const r = await alice.get("/api/explore?" + q);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code, q).toBe("E_QUERY");
    }
  });

  it("카드: 설명, 분류, 좋아요 수, 보는 사람 여부, 예시 출력", async () => {
    const a = await alice.create(doc("hair", [item("a", "red hair"), item("b", "blue hair")], { description: "머리색" }), [4]);
    await bob.put(`/api/wildcards/${a}/like`);
    const [card] = (await bob.get("/api/explore")).body.wildcards;
    expect(card).toMatchObject({ id: a, name: "hair", owner: "alice", description: "머리색", categories: [4], likes: 1, liked: true, favorited: false, forkedFrom: null });
    expect(["red hair", "blue hair"]).toContain(card.example);
  });
});

describe("예시 출력 (저장할 때 고정 seed)", () => {
  const exampleOf = async (id: string) => (await alice.get(`/api/wildcards/${id}`)).body.example as string | null;
  const expected = async (id: string) => {
    const b = JSON.parse((await alice.get(`/api/w/${id}/bundle`)).text);
    const r = expand(b, "0", { rootWildcard: id });
    return r.ok ? r.text : null;
  };

  it("seed 0 전개 결과와 같고, 하위를 고치면 조상의 예시도 다시 계산한다", async () => {
    const leaf = await alice.create(doc("leaf", [item("a", "red"), item("b", "blue"), item("c", "green")]));
    const mid = await alice.create(doc("mid", [item("a", `${W(leaf)} hair`)]));
    const root = await alice.create(doc("root", [item("a", `1girl, ${W(mid)}`)]));
    for (const id of [leaf, mid, root]) expect(await exampleOf(id)).toBe(await expected(id));
    await alice.put(`/api/wildcards/${leaf}`, { doc: doc("leaf", [item("a", "silver"), item("b", "gold"), item("c", "black")]) });
    for (const id of [leaf, mid, root]) expect(await exampleOf(id)).toBe(await expected(id));
    expect(await exampleOf(root)).toMatch(/^1girl, (silver|gold|black) hair$/);
  });

  it("가져온 복사본의 예시는 원본과 같다 (같은 seed, 항목 ID 유지)", async () => {
    const leaf = await alice.create(doc("leaf", [item("a", "red"), item("b", "blue"), item("c", "green")]));
    const root = await alice.create(doc("root", [item("a", `x ${W(leaf)} ${W(leaf)}`)]));
    const r = await bob.post(`/api/wildcards/${root}/import`);
    expect((await bob.get(`/api/wildcards/${r.body.root}`)).body.example).toBe(await exampleOf(root));
  });

  it("전개가 실패하면 null (깊이 초과)", async () => {
    let prev = await alice.create(doc("d0", [item("a", "x")]));
    for (let i = 1; i <= 17; i++) prev = await alice.create(doc(`d${i}`, [item("a", W(prev))]));
    expect(await exampleOf(prev)).toBeNull();
  });

  it("300자로 자른다", async () => {
    const id = await alice.create(doc("long", [item("a", "가".repeat(400))]));
    expect([...((await exampleOf(id)) ?? "")].length).toBe(300);
  });
});

describe("여러 ID 조회 (lookup)", () => {
  it("있는 것만 돌려주고 로그인 없이 된다", async () => {
    const a = await alice.create(doc("a", [item("a", "1")], { description: "설명" }));
    const b = await bob.create(doc("b", [item("a", "1")]));
    const gone = await alice.create(doc("gone", [item("a", "1")]));
    await alice.del(`/api/wildcards/${gone}`);
    const r = await new Client(env).post("/api/lookup", { ids: [a, b, gone, "AAAAAAAAAAAA", a] });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.wildcards).sort()).toEqual([a, b].sort());
    expect(r.body.wildcards[a]).toMatchObject({ name: "a", owner: "alice", description: "설명", version: 1 });
  });

  it("복사본은 원작자를 알려 준다", async () => {
    const a = await alice.create(doc("a", [item("a", "1")]));
    const r = await bob.post(`/api/wildcards/${a}/import`);
    const l = await bob.post("/api/lookup", { ids: [r.body.root] });
    expect(l.body.wildcards[r.body.root].forkedFrom).toMatchObject({ wildcard: a, owner: "alice" });
  });

  it("형식·개수 제한", async () => {
    expect((await alice.post("/api/lookup", { ids: ["bad"] })).status).toBe(400);
    expect((await alice.post("/api/lookup", { ids: Array.from({ length: 201 }, () => "AAAAAAAAAAAA") })).status).toBe(400);
    expect((await alice.post("/api/lookup", { ids: [], extra: 1 })).status).toBe(400);
    expect((await alice.post("/api/lookup", { ids: [] })).body).toEqual({ wildcards: {} });
  });
});

describe("사용자별 목록", () => {
  it("복사본도 나오고 원작자를 표시, 대소문자 무시", async () => {
    await bob.create(doc("own", [item("a", "1")]));
    const a = await alice.create(doc("src", [item("a", "1")]));
    await bob.post(`/api/wildcards/${a}/import`);
    const r = await new Client(env).get("/api/users/BOB/wildcards");
    expect(r.body.user).toEqual({ username: "bob" });
    expect(r.body.wildcards.map((w: { name: string; forkedFrom: { owner: string } | null }) => [w.name, w.forkedFrom?.owner ?? null])).toEqual([
      ["own", null],
      ["src", "alice"],
    ]);
  });

  it("없는 아이디·형식이 틀린 아이디는 404", async () => {
    expect((await alice.get("/api/users/nobody/wildcards")).status).toBe(404);
    expect((await alice.get("/api/users/a%2F..%2Fb/wildcards")).status).toBe(404);
    expect((await alice.get("/api/users/" + encodeURIComponent("bob' or '1'='1") + "/wildcards")).status).toBe(404);
  });
});

describe("비밀번호 변경", () => {
  it("현재 비밀번호 확인, 다른 세션은 끊기고 지금 세션은 남는다", async () => {
    const other = new Client(env);
    expect((await other.post("/api/auth/login", { username: "alice", password: "password123" })).status).toBe(200);

    let r = await alice.post("/api/auth/password", { current: "wrong-password", next: "newpassword1" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("E_PASSWORD_WRONG");
    r = await alice.post("/api/auth/password", { current: "password123", next: "short" });
    expect(r.body.error.code).toBe("E_PASSWORD");

    r = await alice.post("/api/auth/password", { current: "password123", next: "newpassword1" });
    expect(r.status).toBe(200);
    expect((await alice.get("/api/me")).status).toBe(200);
    expect((await other.get("/api/me")).status).toBe(401);
    expect((await new Client(env).post("/api/auth/login", { username: "alice", password: "password123" })).status).toBe(401);
    expect((await new Client(env).post("/api/auth/login", { username: "alice", password: "newpassword1" })).status).toBe(200);
  });

  it("로그인 필요, 모르는 필드 거부", async () => {
    expect((await new Client(env).post("/api/auth/password", { current: "password123", next: "newpassword1" })).status).toBe(401);
    expect((await alice.post("/api/auth/password", { current: "password123", next: "newpassword1", owner_id: "1" })).status).toBe(400);
  });
});
