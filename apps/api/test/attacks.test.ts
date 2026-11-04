// DESIGN 12절의 공격 입력. 거부되거나 무해한 데이터로 저장돼야 하고, 500이 나면 안 된다.

import { canonicalize, contentHash } from "@wakaaka/core/hash";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, doc, setupEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let alice: Client;
beforeEach(async () => {
  env = await setupEnv();
  alice = await new Client(env).signup("alice");
});
afterEach(async () => {
  await env.close();
});

const rawCreate = (raw: string) => alice.request("POST", "/api/wildcards", undefined, { raw });
const contentCount = async () => Number((await env.db.selectFrom("wc_content").select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n);

describe("문자열", () => {
  it("U+0000은 거부 (Postgres jsonb 500을 막는다)", async () => {
    for (const raw of [
      '{"doc":{"schema":1,"name":"a\\u0000b","items":[]}}',
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x\\u0000"}]}}',
      '{"doc":{"schema":1,"name":"n","description":"\\u0000","items":[]}}',
      '{"doc":{"schema":1,"name":"n","select":{"sep":"\\u0000"},"items":[]}}',
    ]) {
      const r = await rawCreate(raw);
      expect(r.status, raw).toBe(400);
      expect(r.body.error.code).toBe("E_SCHEMA");
    }
    expect(await contentCount()).toBe(0);
  });

  it("짝 없는 서로게이트는 거부", async () => {
    for (const s of ["\\ud800", "\\udc00", "a\\ud83d", "\\ude00\\ud83d"]) {
      const r = await rawCreate(`{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"${s}"}]}}`);
      expect(r.status, s).toBe(400);
      expect(r.body.error.code).toBe("E_SCHEMA");
    }
    // 짝이 맞는 서로게이트(이모지)는 받는다
    expect((await rawCreate('{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"\\ud83d\\ude00"}]}}')).status).toBe(201);
  });

  it("탭·줄바꿈·CR을 뺀 C0 제어문자는 거부", async () => {
    expect((await rawCreate('{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"\\u001b[31m"}]}}')).status).toBe(400);
    expect((await rawCreate('{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"a\\tb\\nc\\r"}]}}')).status).toBe(201);
  });
});

describe("JSON 처리 차이", () => {
  it("중복 키는 어느 단계에서든 거부", async () => {
    for (const raw of [
      '{"doc":{"schema":1,"name":"a","name":"b","items":[]}}',
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x","text":"y"}]}}',
      '{"doc":{"schema":1,"name":"n","items":[]},"doc":{"schema":1,"name":"m","items":[]}}',
      // 이스케이프를 풀면 같은 키
      '{"doc":{"schema":1,"name":"a","n\\u0061me":"b","items":[]}}',
    ]) {
      const r = await rawCreate(raw);
      expect(r.status, raw).toBe(400);
      expect(r.body.error.code).toBe("E_JSON_DUPLICATE_KEY");
    }
    // 다른 객체에 같은 키, 문자열 값 안의 키 모양은 괜찮다
    expect((await rawCreate('{"doc":{"schema":1,"name":"n","description":"\\"name\\":1","items":[{"id":"a","text":"x"},{"id":"b","text":"y"}]}}')).status).toBe(201);
    expect(await contentCount()).toBe(1);
  });

  it("1e400(JS Infinity, Postgres 큰 정수, Python inf)은 거부", async () => {
    for (const raw of [
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x","w":1e400}]}}',
      '{"doc":{"schema":1e400,"name":"n","items":[]}}',
      '{"doc":{"schema":1,"name":"n","select":{"count":[1,1e400]},"items":[]}}',
      '{"doc":{"schema":1,"name":"n","items":[]},"categories":[1e400]}',
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x","w":1.5}]}}',
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x","w":-1}]}}',
    ]) {
      const r = await rawCreate(raw);
      expect(r.status, raw).toBe(400);
      expect(r.body.error.code).toBe("E_SCHEMA");
    }
    // 정수값인 소수는 정수로 받고 정규화하면 정수로 쓴다
    const r = await rawCreate('{"doc":{"schema":1.0,"name":"n","items":[{"id":"a","text":"x","w":3.0},{"id":"b","text":"y","w":1e2}]}}');
    expect(r.status).toBe(201);
    const row = await env.db.selectFrom("wc_content").select("doc").executeTakeFirstOrThrow();
    expect(canonicalize(row.doc)).toBe('{"items":[{"id":"a","text":"x","w":3},{"id":"b","text":"y","w":100}],"name":"n","schema":1}');
  });

  it("__proto__ 키는 거부하고 전역 프로토타입이 오염되지 않는다", async () => {
    for (const raw of [
      '{"doc":{"schema":1,"name":"n","items":[],"__proto__":{"polluted":"yes"}}}',
      '{"doc":{"schema":1,"name":"n","items":[{"id":"a","text":"x","__proto__":{"polluted":"yes"}}]}}',
      '{"__proto__":{"polluted":"yes"},"doc":{"schema":1,"name":"n","items":[]}}',
      '{"doc":{"schema":1,"name":"n","items":[],"constructor":{"prototype":{"polluted":"yes"}}}}',
    ]) {
      const r = await rawCreate(raw);
      expect(r.status, raw).toBe(400);
      expect(r.body.error.code).toBe("E_SCHEMA");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await contentCount()).toBe(0);
  });

  it("모르는 필드는 문서·select·항목·ref·요청 껍데기 어디서든 거부", async () => {
    const base = { schema: 1, name: "n", items: [{ id: "a", text: "x" }] };
    for (const body of [
      { doc: { ...base, hidden: "payload" } },
      { doc: { ...base, select: { count: [1, 1], order: "doc" } } }, // 예약된 select.order도 지금은 거부
      { doc: { ...base, items: [{ id: "a", text: "x", note: "hidden" }] } },
      { doc: { ...base, items: [{ id: "a", ref: { wildcard: "AAAAAAAAAAAA", hash: "BBBBBBBBBBBB" } }] } },
      { doc: base, owner_id: "1" },
      { doc: base, forked_from_wildcard: "AAAAAAAAAAAA" },
      { doc: base, latest_seq: 99 },
    ]) {
      const r = await alice.post("/api/wildcards", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("E_SCHEMA");
    }
    expect(await contentCount()).toBe(0);
  });

  it("깊게 중첩한 JSON은 400으로 끝난다(500 아님)", async () => {
    const raw = '{"doc":' + "[".repeat(100000) + "]".repeat(100000) + "}";
    const r = await rawCreate(raw);
    expect(r.status).toBe(400);
  });

  it("JSON이 아니거나 Content-Type이 다르면 거부", async () => {
    expect((await rawCreate("{doc:")).body.error.code).toBe("E_JSON");
    const r = await alice.request("POST", "/api/wildcards", undefined, { raw: JSON.stringify({ doc: doc("n", []) }), contentType: "text/plain" });
    expect(r.status).toBe(415);
  });
});

describe("SQL", () => {
  it("SQL 문자열은 데이터로 저장되고 그대로 돌아온다", async () => {
    const evil = "'); DROP TABLE wildcard; --";
    const name = "x' OR 1<2; DROP TABLE owner; --"; // 이름에는 = 를 쓸 수 없다
    const id = await alice.create(doc(name, [{ id: "a", text: evil }], { description: "\"; DELETE FROM owner; --" }));
    const g = await alice.get(`/api/wildcards/${id}`);
    expect(g.body.name).toBe(name);
    expect(g.body.doc.items[0].text).toBe(evil);
    const tables = await sql<{ n: number }>`select count(*)::int as n from information_schema.tables where table_schema = ${env.schema}`.execute(env.db);
    expect(tables.rows[0]!.n).toBeGreaterThanOrEqual(6);
    // 이름으로 로그인 조회도 바인딩된다
    const r = await new Client(env).post("/api/auth/login", { username: "alice' --", password: "password123" });
    expect(r.status).toBe(401);
    expect((await new Client(env).post("/api/auth/signup", { username: "x' OR 1=1", password: "password123" })).status).toBe(400);
  });

  it("경로와 쿼리의 SQL 문자열", async () => {
    expect((await alice.get("/api/wildcards/'%20OR%201=1--")).status).toBe(404);
    const id = await alice.create(doc("n", [{ id: "a", text: "x" }]));
    expect((await alice.get(`/api/wildcards/${id}?v=1;DROP`)).status).toBe(400);
    expect((await alice.get(`/api/w/${id}/resolve?seed=1'--`)).status).toBe(400);
    expect((await alice.get(`/api/w/${id}/resolve?seed=1&lock=${id}:'--`)).status).toBe(400);
  });
});

describe("권한", () => {
  it("남의 와일드카드는 고치거나 지울 수 없다", async () => {
    const id = await alice.create(doc("mine", [{ id: "a", text: "x" }]));
    const bob = await new Client(env).signup("bob");
    const put = await bob.put(`/api/wildcards/${id}`, { doc: doc("mine", [{ id: "a", text: "hacked" }]) });
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe("E_FORBIDDEN");
    expect((await bob.del(`/api/wildcards/${id}`)).status).toBe(403);
    const g = await alice.get(`/api/wildcards/${id}`);
    expect(g.body.version).toBe(1);
    expect(g.body.doc.items[0].text).toBe("x");
  });

  it("로그인하지 않으면 쓰기 불가", async () => {
    const id = await alice.create(doc("mine", []));
    const anon = new Client(env);
    expect((await anon.post("/api/wildcards", { doc: doc("x", []) })).status).toBe(401);
    expect((await anon.put(`/api/wildcards/${id}`, { doc: doc("x", []) })).status).toBe(401);
    expect((await anon.del(`/api/wildcards/${id}`)).status).toBe(401);
    expect((await anon.post(`/api/wildcards/${id}/import`)).status).toBe(401);
  });

  it("가짜 세션 쿠키는 무시", async () => {
    const c = new Client(env);
    c.cookie = "x'; DROP TABLE session; --";
    expect((await c.get("/api/me")).status).toBe(401);
  });
});

describe("내용 해시 충돌 모의", () => {
  it("DB에 (hash(B), A 내용)이 있으면 B 저장을 거부하고 기록한다", async () => {
    const A = doc("malicious", [{ id: "a", text: "evil" }]);
    const B = doc("harmless", [{ id: "a", text: "nice" }]);
    const hB = contentHash(B);
    const canonA = canonicalize(A);
    await env.db.insertInto("wc_content").values({ hash: hB, doc: canonA, size: Buffer.byteLength(canonA) }).execute();

    const logged: string[] = [];
    const orig = console.error;
    console.error = (m: string) => void logged.push(String(m));
    let r;
    try {
      r = await alice.post("/api/wildcards", { doc: B });
    } finally {
      console.error = orig;
    }
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "E_HASH_COLLISION", hash: hB });
    expect(logged.some((l) => l.includes("hash_collision") && l.includes(hB))).toBe(true);
    // 아무것도 저장되지 않았고, 행은 A 그대로
    expect(await env.db.selectFrom("wildcard").selectAll().execute()).toEqual([]);
    const row = await env.db.selectFrom("wc_content").select("doc").where("hash", "=", hB).executeTakeFirstOrThrow();
    expect(row.doc).toEqual(A);
  });

  it("같은 내용은 해시를 공유한다(바이트가 같으면 통과)", async () => {
    const bob = await new Client(env).signup("bob");
    const d = doc("shared", [{ id: "a", text: "same" }]);
    const a = await alice.post("/api/wildcards", { doc: d });
    const b = await bob.post("/api/wildcards", { doc: { items: d.items, name: "shared", schema: 1 } }); // 키 순서만 다름
    expect(b.status).toBe(201);
    expect(b.body.hash).toBe(a.body.hash);
    expect(await contentCount()).toBe(1);
  });
});

describe("Phase 3 엔드포인트 (즐겨찾기, 좋아요, 둘러보기, lookup, 사용자, 비밀번호)", () => {
  const sqlStrings = ["'; DROP TABLE wildcard; --", "\" OR 1=1 --", "%' OR '1'='1", "\'; select pg_sleep(5); --", "$1", "${w:AAAAAAAAAAAA}"];

  it("검색어의 SQL 문자열은 데이터로만 쓰이고 테이블은 그대로다", async () => {
    await alice.create(doc("safe", [{ id: "a", text: "x" }]));
    for (const s of sqlStrings) {
      const r = await alice.get("/api/explore?q=" + encodeURIComponent(s));
      expect(r.status, s).toBe(200);
      expect(r.body.wildcards, s).toEqual([]);
    }
    // 같은 문자열을 이름에 넣고 찾으면 그것만 나온다
    const name = "'; DROP TABLE wildcard; --";
    await alice.create(doc(name.replace(/[{}$\|=:]/g, ""), [{ id: "a", text: "x" }]));
    expect((await alice.get("/api/explore?q=" + encodeURIComponent("DROP TABLE"))).body.wildcards.map((w: { name: string }) => w.name)).toEqual([name]);
    expect((await alice.get("/api/explore")).body.wildcards).toHaveLength(2);
  });

  it("정렬·분류에는 식별자를 넣을 수 없다 (enum, 숫자 목록)", async () => {
    for (const q of ["sort=" + encodeURIComponent("like_count; drop table wildcard"), "sort=" + encodeURIComponent("w.name"), "cat=" + encodeURIComponent("1) or (1=1"), "cat=" + encodeURIComponent("{1,2}")]) {
      expect((await alice.get("/api/explore?" + q)).status, q).toBe(400);
    }
  });

  it("권한 필드는 본문에서 받지 않는다 (즐겨찾기 owner_id, 좋아요 수)", async () => {
    const bob = await new Client(env).signup("bob");
    const a = await bob.create(doc("b", [{ id: "a", text: "x" }]));
    const r = await alice.post("/api/favorites", { wildcard: a, owner_id: "1" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("E_SCHEMA");
    // 좋아요는 본문을 읽지 않는다. 본문에 like_count를 넣어도 1만 오른다
    const l = await alice.request("PUT", `/api/wildcards/${a}/like`, { like_count: 1000, likes: 1000 });
    expect(l.body.likes).toBe(1);
    // 저장 본문으로도 like_count·example을 바꿀 수 없다
    expect((await bob.put(`/api/wildcards/${a}`, { doc: doc("b", [{ id: "a", text: "y" }]), like_count: 999 })).status).toBe(400);
    expect((await bob.put(`/api/wildcards/${a}`, { doc: doc("b", [{ id: "a", text: "y" }]), example: "<script>" })).status).toBe(400);
  });

  it("lookup·즐겨찾기 본문의 __proto__와 중복 키는 거부", async () => {
    for (const raw of ['{"ids":[],"__proto__":{"x":1}}', '{"ids":[],"ids":["AAAAAAAAAAAA"]}']) {
      expect((await alice.request("POST", "/api/lookup", undefined, { raw })).status, raw).toBe(400);
    }
    expect((await alice.request("POST", "/api/favorites", undefined, { raw: '{"wildcard":"AAAAAAAAAAAA","__proto__":{}}' })).status).toBe(400);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("lookup 본문 크기 제한 (파싱 전 413)", async () => {
    const raw = JSON.stringify({ ids: ["A".repeat(20 * 1024)] });
    expect((await alice.request("POST", "/api/lookup", undefined, { raw })).status).toBe(413);
  });

  it("lookup의 ID 자리에 SQL 문자열 → 400, 경로의 사용자 이름 → 404", async () => {
    for (const s of sqlStrings) {
      expect((await alice.post("/api/lookup", { ids: [s] })).status, s).toBe(400);
      expect((await alice.get(`/api/users/${encodeURIComponent(s)}/wildcards`)).status, s).toBe(404);
      expect((await alice.put(`/api/wildcards/${encodeURIComponent(s)}/like`)).status, s).toBe(404);
      expect((await alice.del(`/api/favorites/${encodeURIComponent(s)}`)).status, s).toBe(404);
    }
  });

  it("남의 세션으로 바꿀 수 없다: 좋아요·즐겨찾기는 세션 소유자 것만", async () => {
    const bob = await new Client(env).signup("bob");
    const carol = await new Client(env).signup("carol");
    const a = await bob.create(doc("b", [{ id: "a", text: "x" }]));
    await carol.put(`/api/wildcards/${a}/like`);
    await carol.post("/api/favorites", { wildcard: a });
    // alice가 지워도 carol 것은 남는다
    await alice.del(`/api/wildcards/${a}/like`);
    await alice.del(`/api/favorites/${a}`);
    expect((await carol.get(`/api/wildcards/${a}`)).body.viewer).toEqual({ liked: true, favorited: true });
    expect((await carol.get(`/api/wildcards/${a}`)).body.likes).toBe(1);
  });

  it("비밀번호 변경: CSRF 폼 전송(text/plain)은 415, 틀린 현재 비밀번호는 시간이 걸려도 400", async () => {
    const r = await alice.request("POST", "/api/auth/password", undefined, { raw: '{"current":"password123","next":"newpassword1"}', contentType: "text/plain" });
    expect(r.status).toBe(415);
    expect((await alice.post("/api/auth/password", { current: "a".repeat(300), next: "newpassword1" })).body.error.code).toBe("E_PASSWORD_WRONG");
    expect((await alice.post("/api/auth/password", { current: "\ud800", next: "newpassword1" })).body.error.code).toBe("E_PASSWORD_WRONG");
  });
});
