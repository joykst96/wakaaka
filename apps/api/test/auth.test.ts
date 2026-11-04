import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, setupEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
beforeEach(async () => {
  env = await setupEnv();
});
afterEach(async () => {
  await env.close();
});

describe("계정", () => {
  it("가입하면 세션 쿠키가 생기고 me가 된다", async () => {
    const c = new Client(env);
    const r = await c.post("/api/auth/signup", { username: "Alice_01", password: "password123" });
    expect(r.status).toBe(201);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^wk_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    const me = await c.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ username: "Alice_01" });
    expect(me.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(me.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("세션 토큰은 DB에 sha256만 남고 비밀번호는 argon2id다", async () => {
    const c = await new Client(env).signup("bob");
    const s = await env.db.selectFrom("session").select("token_hash").executeTakeFirstOrThrow();
    expect(s.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.token_hash).not.toBe(c.cookie);
    const o = await env.db.selectFrom("owner").select("pw_hash").executeTakeFirstOrThrow();
    expect(o.pw_hash).toMatch(/^\$argon2id\$v=19\$/);
  });

  it("아이디는 대소문자를 무시하고 유일하다", async () => {
    await new Client(env).signup("Carol");
    const r = await new Client(env).post("/api/auth/signup", { username: "cAROL", password: "password123" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("E_USERNAME_TAKEN");
  });

  it("로그인은 대소문자를 무시하고, 표시는 가입한 대로", async () => {
    await new Client(env).signup("Dave");
    const c = new Client(env);
    const r = await c.post("/api/auth/login", { username: "dave", password: "password123" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ username: "Dave" });
    expect((await c.get("/api/me")).body.username).toBe("Dave");
  });

  it("틀린 비밀번호와 없는 아이디는 같은 오류", async () => {
    await new Client(env).signup("erin");
    const a = await new Client(env).post("/api/auth/login", { username: "erin", password: "wrong-password" });
    const b = await new Client(env).post("/api/auth/login", { username: "nobody", password: "wrong-password" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("로그아웃하면 세션이 지워진다", async () => {
    const c = await new Client(env).signup("frank");
    const token = c.cookie;
    const r = await c.post("/api/auth/logout");
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/^wk_session=;/);
    expect(c.cookie).toBeNull();
    expect((await c.get("/api/me")).status).toBe(401);
    // 지운 토큰을 다시 써도 안 된다
    c.cookie = token;
    expect((await c.get("/api/me")).status).toBe(401);
  });

  it("아이디와 비밀번호 규칙", async () => {
    const c = new Client(env);
    for (const username of ["ab", "a".repeat(33), "한글이름", "a b", "a.b"]) {
      const r = await c.post("/api/auth/signup", { username, password: "password123" });
      expect(r.status, username).toBe(400);
      expect(r.body.error.code).toBe("E_USERNAME");
    }
    for (const password of ["1234567", "x".repeat(257), "abcdefg\ud800"]) {
      const r = await c.post("/api/auth/signup", { username: "gina", password });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("E_PASSWORD");
    }
    // 코드 포인트로 센다: 이모지 8개는 UTF-16 16단위지만 8자
    expect((await c.post("/api/auth/signup", { username: "gina", password: "😀".repeat(8) })).status).toBe(201);
  });

  it("모르는 필드와 JSON 아닌 본문은 거부", async () => {
    const c = new Client(env);
    const r = await c.post("/api/auth/signup", { username: "hank", password: "password123", admin: true });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("E_SCHEMA");
    const t = await c.request("POST", "/api/auth/signup", undefined, { raw: "username=hank", contentType: "application/x-www-form-urlencoded" });
    expect(t.status).toBe(415);
  });

  it("로그인 없이 me는 401", async () => {
    const r = await new Client(env).get("/api/me");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("E_AUTH");
  });
});
