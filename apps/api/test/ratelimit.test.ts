// 앱 안의 속도 제한 (DESIGN 9절 "속도 제한", 사용자 결정 2026-11-04). 시계를 테스트가 움직인다.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { Buckets, classify, type RateLimitConfig } from "../src/ratelimit.ts";
import { Client, doc, setupEnv, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let now = 1_000_000;
const limits = (trustCfIp: boolean): RateLimitConfig => ({
  writeAccount: { max: 3, windowMs: 60_000 },
  writeIp: { max: 5, windowMs: 60_000 },
  signupIp: { max: 2, windowMs: 3_600_000 },
  loginIp: { max: 3, windowMs: 600_000 },
  trustCfIp,
  now: () => now,
});

/** 속도 제한을 켠 앱을 같은 DB에 붙인다 */
function limitedEnv(trustCfIp: boolean): TestEnv {
  return { ...env, app: createApp({ db: env.db, rateLimit: limits(trustCfIp) }) };
}
function from(e: TestEnv, ip?: string) {
  const c = new Client(e);
  const orig = c.request.bind(c);
  c.request = (method, path, body, init = {}) => orig(method, path, body, { ...init, headers: { ...init.headers, ...(ip ? { "cf-connecting-ip": ip } : {}) } });
  return c;
}

beforeEach(async () => {
  env = await setupEnv();
  now = 1_000_000;
});
afterEach(async () => {
  await env.close();
});

describe("분류", () => {
  it.each([
    ["GET", "/api/wildcards", null],
    ["GET", "/api/w/AAAAAAAAAAAA/resolve", null],
    ["POST", "/api/lookup", null],
    ["POST", "/api/tags/lookup", null],
    ["POST", "/api/auth/logout", null],
    ["POST", "/api/auth/signup", "signup"],
    ["POST", "/api/auth/login", "login"],
    ["POST", "/api/auth/password", "login"],
    ["POST", "/api/wildcards", "write"],
    ["PUT", "/api/wildcards/AAAAAAAAAAAA", "write"],
    ["DELETE", "/api/wildcards/AAAAAAAAAAAA", "write"],
    ["POST", "/api/wildcards/AAAAAAAAAAAA/import", "write"],
    ["PUT", "/api/wildcards/AAAAAAAAAAAA/like", "write"],
    ["POST", "/api/favorites", "write"],
    ["DELETE", "/api/favorites/AAAAAAAAAAAA", "write"],
    ["POST", "/api/nope", "write"],
    ["POST", "/index.html", null],
  ])("%s %s → %s", (m, p, kind) => {
    expect(classify(m, p)).toBe(kind);
  });

  it("버킷: 다 쓰면 다시 찰 때까지의 초, 시간이 지나면 하나씩 찬다", () => {
    let t = 0;
    const b = new Buckets(() => t, 60_000);
    const l = { max: 2, windowMs: 60_000 };
    expect(b.take("k", l)).toEqual({ ok: true });
    expect(b.take("k", l)).toEqual({ ok: true });
    expect(b.take("k", l)).toEqual({ ok: false, retryAfter: 30 });
    t = 29_000;
    expect(b.take("k", l).ok).toBe(false);
    t = 30_000;
    expect(b.take("k", l)).toEqual({ ok: true });
    expect(b.take("other", l)).toEqual({ ok: true });
  });

  it("오래 안 쓴 버킷은 지워진다(메모리)", () => {
    let t = 0;
    const b = new Buckets(() => t, 60_000);
    const l = { max: 1, windowMs: 60_000 };
    for (let i = 0; i < 999; i++) b.take(`k${i}`, l);
    t = 61_000;
    b.take("last", l); // 1000번째 호출에서 정리
    expect(b.size).toBe(1);
  });
});

describe("쓰기", () => {
  it("계정당: 넘으면 429와 Retry-After, 읽기와 읽기용 POST는 그대로, 시간이 지나면 다시", async () => {
    const e = limitedEnv(true);
    const alice = await from(e, "203.0.113.1").signup("alice");
    for (let i = 0; i < 3; i++) await alice.create(doc(`w${i}`, [{ id: "a", text: "x" }]));
    const r = await alice.post("/api/wildcards", { doc: doc("w3", [{ id: "a", text: "x" }]) });
    expect(r.status).toBe(429);
    expect(r.body.error).toEqual({ code: "E_RATE_LIMIT", message: "too many requests", retryAfter: 20 });
    expect(r.headers.get("retry-after")).toBe("20");
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // 거부된 것은 저장되지 않았다
    expect((await alice.get("/api/wildcards")).body.wildcards).toHaveLength(3);
    for (let i = 0; i < 10; i++) {
      expect((await alice.get("/api/explore")).status).toBe(200);
      expect((await alice.post("/api/lookup", { ids: [] })).status).toBe(200);
      expect((await alice.post("/api/tags/lookup", { names: ["x"] })).status).toBe(200);
    }
    // 같은 IP의 다른 계정은 계정 버킷이 따로. IP 버킷 5 중 3을 썼고, 거부된 4번째는 IP 버킷을 깎지 않았다 → 2개 더
    const bob = await from(e, "203.0.113.1").signup("bob");
    await bob.create(doc("b0", [{ id: "a", text: "x" }]));
    await bob.create(doc("b1", [{ id: "a", text: "x" }]));
    expect((await bob.post("/api/wildcards", { doc: doc("b2", []) })).status).toBe(429); // IP 버킷이 다 참
    now += 20_000;
    expect((await alice.post("/api/wildcards", { doc: doc("w3", [{ id: "a", text: "x" }]) })).status).toBe(201);
  });

  it("IP당: 다른 CF-Connecting-IP는 따로 센다", async () => {
    const e = limitedEnv(true);
    const a = await from(e, "198.51.100.7").signup("alice");
    const b = await from(e, "2001:db8::1").signup("bob");
    for (let i = 0; i < 3; i++) await a.create(doc(`a${i}`, []));
    for (let i = 0; i < 3; i++) await b.create(doc(`b${i}`, []));
  });

  it("헤더를 믿지 않으면 바꿔 보내도 같은 IP로 센다(스푸핑)", async () => {
    const e = limitedEnv(false);
    const ok = [];
    for (let i = 0; i < 4; i++) ok.push((await from(e, `192.0.2.${i}`).post("/api/auth/signup", { username: `user${i}`, password: "password123" })).status);
    expect(ok).toEqual([201, 201, 429, 429]);
  });

  it("믿어도 IP 모양이 아니거나 너무 긴 헤더는 버린다", async () => {
    const e = limitedEnv(true);
    const st = [];
    for (const h of ["1".repeat(65), "1.2.3.4; drop", "<script>", "abcdef", "999.1.1.1"]) st.push((await from(e, h).post("/api/auth/signup", { username: `u${st.length}xx`, password: "password123" })).status);
    // 모두 소켓 주소(unknown) 하나로 센다: 2개 뒤 429
    expect(st).toEqual([201, 201, 429, 429, 429]);
  });

  it("거부된 요청은 다른 버킷을 깎지 않는다", async () => {
    const e = limitedEnv(true);
    const a = await from(e, "203.0.113.3").signup("alice");
    for (let i = 0; i < 3; i++) await a.create(doc(`a${i}`, []));
    for (let i = 0; i < 20; i++) expect((await a.post("/api/wildcards", { doc: doc("x", []) })).status).toBe(429);
    const b = await from(e, "203.0.113.3").signup("bob");
    await b.create(doc("b0", []));
    await b.create(doc("b1", []));
  });

  it("로그아웃은 세지 않는다", async () => {
    const e = limitedEnv(true);
    const c = await from(e, "203.0.113.9").signup("alice");
    for (let i = 0; i < 10; i++) expect((await c.post("/api/auth/logout")).status).toBe(200);
  });
});

describe("가입·로그인", () => {
  it("가입 IP당 2개, 다른 IP는 따로, 1시간 뒤 다시", async () => {
    const e = limitedEnv(true);
    const s = (ip: string, u: string) => from(e, ip).post("/api/auth/signup", { username: u, password: "password123" });
    expect((await s("203.0.113.1", "aaa")).status).toBe(201);
    expect((await s("203.0.113.1", "bbb")).status).toBe(201);
    const r = await s("203.0.113.1", "ccc");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("1800");
    expect((await s("203.0.113.2", "ccc")).status).toBe(201);
    now += 1_800_000;
    expect((await s("203.0.113.1", "ddd")).status).toBe(201);
  });

  it("로그인(틀린 비밀번호 포함)과 비밀번호 변경이 같은 버킷", async () => {
    const e = limitedEnv(true);
    const c = await from(e, "203.0.113.5").signup("alice");
    expect((await c.post("/api/auth/login", { username: "alice", password: "wrongwrong" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { username: "alice", password: "password123" })).status).toBe(200);
    expect((await c.post("/api/auth/password", { current: "password123", next: "password456" })).status).toBe(200);
    const r = await c.post("/api/auth/login", { username: "alice", password: "password456" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("E_RATE_LIMIT");
  });

  it("속도 제한을 주지 않은 앱(통합 테스트 기본)은 세지 않는다", async () => {
    const c = await new Client(env).signup("alice");
    for (let i = 0; i < 70; i++) await c.create(doc(`w${i}`, []));
  });
});
