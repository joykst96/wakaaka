// GET /api/w/{id}/export?format=impact (DESIGN 7절, 11절 "Impact Pack 내보내기")

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, doc, setupEnv, W, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let alice: Client;
beforeEach(async () => {
  env = await setupEnv();
  alice = await new Client(env).signup("alice");
});
afterEach(async () => {
  await env.close();
});

describe("Impact Pack 내보내기", () => {
  it("하위를 펼친 한 줄과 경고(위치는 하위 와일드카드 ID), 로그인 없이", async () => {
    const leaf = await alice.create(doc("emote", [{ id: "a", text: ":|" }, { id: "b", text: "smile", w: 3 }]));
    const root = await alice.create(doc("root", [{ id: "r", text: `1girl, {3*red|blue} hair, ${W(leaf)}` }], { select: { count: [1, 1] } }));
    const r = await new Client(env).get(`/api/w/${root}/export?format=impact`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.body).toEqual({
      format: "impact",
      text: "{1::1girl, {3::red|1::blue} hair, {1:::||3::smile}}",
      warnings: [{ code: "W_PIPE", hash: expect.stringMatching(/^[0-9A-Za-z]{12}$/), wildcard: leaf, item: "a" }],
    });
  });

  it("형식은 enum, 모르는 매개변수와 주입 문자열은 400", async () => {
    const id = await alice.create(doc("x", [{ id: "a", text: "x" }]));
    for (const q of ["", "?format=json", "?format=impact&x=1", "?format=" + encodeURIComponent("impact'; drop table wildcard; --")]) {
      const r = await alice.get(`/api/w/${id}/export${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code).toBe("E_QUERY");
    }
  });

  it("없는 것·지운 것·형식이 틀린 ID는 404", async () => {
    const id = await alice.create(doc("gone", [{ id: "a", text: "x" }]));
    await alice.del(`/api/wildcards/${id}`);
    expect((await alice.get(`/api/w/${id}/export?format=impact`)).status).toBe(404);
    expect((await alice.get(`/api/w/AAAAAAAAAAAA/export?format=impact`)).status).toBe(404);
    expect((await alice.get(`/api/w/short/export?format=impact`)).status).toBe(404);
  });

  it("깊이 초과로 전개할 수 없으면 422 E_EXPAND", async () => {
    let prev = await alice.create(doc("d0", [{ id: "a", text: "x" }]));
    for (let i = 1; i <= 17; i++) prev = await alice.create(doc(`d${i}`, [{ id: "a", text: W(prev) }]));
    const r = await alice.get(`/api/w/${prev}/export?format=impact`);
    expect(r.status).toBe(422);
    expect(r.body.error.expand.code).toBe("E_DEPTH");
  });
});
