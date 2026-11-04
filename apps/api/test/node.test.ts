// 노드용 /api/w/{id}/bundle, /resolve, /meta (DESIGN 7절).

import { bundleSchema, expand } from "@wakaaka/core";
import { canonicalize, contentHash } from "@wakaaka/core/hash";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, doc, setupEnv, W, type TestEnv } from "./helpers.ts";

let env: TestEnv;
let alice: Client;
let anon: Client;
let ids: { leaf: string; mid: string; root: string };
beforeEach(async () => {
  env = await setupEnv();
  alice = await new Client(env).signup("alice");
  anon = new Client(env);
  const leaf = await alice.create(doc("leaf", [{ id: "l1", text: "red", w: 2 }, { id: "l2", text: "blue" }]));
  const mid = await alice.create(doc("mid", [{ id: "s", ref: { wildcard: leaf }, spread: true }, { id: "m", text: `${W(leaf)} hat` }], { select: { count: [0, 2] } }));
  const root = await alice.create(doc("root", [{ id: "r", text: `1girl, ${W(mid)}, {smile|grin}, ${W(leaf)} eyes` }]));
  ids = { leaf, mid, root };
});
afterEach(async () => {
  await env.close();
});

const lockParam = (lock: Record<string, string>) =>
  Object.keys(lock)
    .sort()
    .map((k) => `${k}:${lock[k]}`)
    .join(",");

describe("bundle", () => {
  it("닫힌 묶음과 루트를 포함한 lock. 응답은 정규화 JSON 그대로", async () => {
    const r = await anon.get(`/api/w/${ids.root}/bundle`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const b = r.body;
    expect(r.text).toBe(canonicalize(b));
    expect(bundleSchema.safeParse(b).success).toBe(true);
    expect(b.format).toBe(1);
    expect(Object.keys(b.lock).sort()).toEqual([ids.leaf, ids.mid, ids.root].sort());
    expect(b.lock[ids.root]).toBe(b.root);
    // 노드처럼 문서마다 해시를 다시 계산해 키와 대조한다
    for (const [h, d] of Object.entries(b.docs)) expect(contentHash(d)).toBe(h);
    expect(Object.keys(b.docs)).toHaveLength(3);
  });

  it("다이아몬드 의존은 문서 하나로", async () => {
    const d = await alice.create(doc("D", [{ id: "a", text: "x" }]));
    const b1 = await alice.create(doc("B1", [{ id: "a", text: W(d) }]));
    const b2 = await alice.create(doc("B2", [{ id: "a", ref: { wildcard: d } }]));
    const top = await alice.create(doc("top", [{ id: "a", text: `${W(b1)} ${W(b2)}` }]));
    const b = (await anon.get(`/api/w/${top}/bundle`)).body;
    expect(Object.keys(b.lock)).toHaveLength(4);
    expect(Object.keys(b.docs)).toHaveLength(4);
  });

  it("묶음이 닫혀 있지 않으면(DB 불일치) 응답하지 않는다", async () => {
    // 정상 경로로는 생길 수 없는 상태를 DB에서 직접 만든다: 참조되는 와일드카드를 지운 것으로 표시
    await env.db.updateTable("wildcard").set({ deleted_at: new Date() }).where("id", "=", ids.leaf).execute();
    const errs: string[] = [];
    const orig = console.error;
    console.error = (m: string) => void errs.push(String(m));
    try {
      const r = await anon.get(`/api/w/${ids.root}/bundle`);
      expect(r.status).toBe(500);
      expect(r.body.error.code).toBe("E_INTERNAL");
    } finally {
      console.error = orig;
    }
    expect(errs.some((e) => e.includes("bundle_not_closed"))).toBe(true);
  });
});

describe("resolve", () => {
  it("core expand와 같은 결과와 lock을 돌려준다", async () => {
    const b = (await anon.get(`/api/w/${ids.root}/bundle`)).body;
    const texts = new Set<string>();
    for (const seed of ["0", "1", "2", "42", "18446744073709551615"]) {
      const r = await anon.get(`/api/w/${ids.root}/resolve?seed=${seed}`);
      expect(r.status).toBe(200);
      const e = expand(b, seed);
      expect(e.ok).toBe(true);
      expect(r.body).toEqual({ text: (e as { text: string }).text, seed, root: b.root, lock: b.lock });
      texts.add(r.body.text);
    }
    expect(texts.size).toBeGreaterThan(1);
  });

  it("seed 검사: 10진수 0..2^64-1, 앞의 0은 뗀다", async () => {
    expect((await anon.get(`/api/w/${ids.root}/resolve?seed=007`)).body.seed).toBe("7");
    for (const s of ["", "-1", "18446744073709551616", "1e3", "0x10", "1.0", "123456789012345678901"]) {
      const r = await anon.get(`/api/w/${ids.root}/resolve?seed=${encodeURIComponent(s)}`);
      expect(r.status, s).toBe(400);
      expect(r.body.error.code).toBe("E_SEED");
    }
    expect((await anon.get(`/api/w/${ids.root}/resolve`)).status).toBe(400);
  });

  it("lock으로 고정하면 하위나 루트를 고쳐도 같은 결과가 나온다", async () => {
    const before = await anon.get(`/api/w/${ids.root}/resolve?seed=5`);
    const lock = lockParam(before.body.lock);
    await alice.put(`/api/wildcards/${ids.leaf}`, { doc: doc("leaf", [{ id: "l1", text: "NEW" }]) });
    await alice.put(`/api/wildcards/${ids.root}`, { doc: doc("root", [{ id: "r", text: `NEW ROOT ${W(ids.mid)}` }]) });
    const latest = await anon.get(`/api/w/${ids.root}/resolve?seed=5`);
    expect(latest.body.text).not.toBe(before.body.text);
    const pinned = await anon.get(`/api/w/${ids.root}/resolve?seed=5&lock=${lock}`);
    expect(pinned.status).toBe(200);
    expect(pinned.body).toEqual(before.body);
    expect(pinned.headers.get("cache-control")).toBe("public, max-age=300");
    expect(latest.headers.get("cache-control")).toBe("no-store");
  });

  it("일부만 고정: 루트에서 닿는 참조가 lock에 없으면 최신으로 채우지 않고 오류", async () => {
    const b = (await anon.get(`/api/w/${ids.root}/bundle`)).body;
    const partial = { [ids.root]: b.lock[ids.root], [ids.mid]: b.lock[ids.mid] };
    const r = await anon.get(`/api/w/${ids.root}/resolve?seed=1&lock=${lockParam(partial)}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "E_LOCK_INCOMPLETE", missing: ids.leaf });
  });

  it("루트가 없는 lock, 형식이 틀린 lock은 거부", async () => {
    const b = (await anon.get(`/api/w/${ids.root}/bundle`)).body;
    const noRoot = { [ids.mid]: b.lock[ids.mid], [ids.leaf]: b.lock[ids.leaf] };
    expect((await anon.get(`/api/w/${ids.root}/resolve?seed=1&lock=${lockParam(noRoot)}`)).body.error.code).toBe("E_LOCK");
    const lp = lockParam(b.lock);
    for (const bad of ["", "x", lp + ",", lp.replace(",", ";"), `${lp},${ids.leaf}:${b.lock[ids.leaf]}`, encodeURIComponent(JSON.stringify(b.lock))]) {
      const r = await anon.get(`/api/w/${ids.root}/resolve?seed=1&lock=${bad}`);
      expect(r.status, bad).toBe(400);
      expect(r.body.error.code).toBe("E_LOCK");
    }
  });

  it("lock 쌍은 그 와일드카드의 실제 버전이어야 한다", async () => {
    const b = (await anon.get(`/api/w/${ids.root}/bundle`)).body;
    // leaf에 mid의 해시를 붙인 lock (해시는 존재하지만 leaf의 버전이 아니다)
    const swapped = { ...b.lock, [ids.leaf]: b.lock[ids.mid] };
    const r = await anon.get(`/api/w/${ids.root}/resolve?seed=1&lock=${lockParam(swapped)}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "E_LOCK_INVALID", wildcard: ids.leaf });
    // 남의 와일드카드 버전을 끼워 넣어도 거부한다(닿지 않는 항목이어도)
    const bob = await new Client(env).signup("bob");
    const bobs = await bob.create(doc("x", [{ id: "a", text: "x" }]));
    const bh = (await bob.get(`/api/wildcards/${bobs}`)).body.hash;
    const foreign = { ...b.lock, [bobs]: bh };
    expect((await anon.get(`/api/w/${ids.root}/resolve?seed=1&lock=${lockParam(foreign)}`)).body.error.code).toBe("E_LOCK_INVALID");
  });

  it("닿지 않는 lock 항목은 무시하고 응답 lock에서 뺀다", async () => {
    const other = await alice.create(doc("other", [{ id: "a", text: "x" }]));
    const oh = (await alice.get(`/api/wildcards/${other}`)).body.hash;
    const base = await anon.get(`/api/w/${ids.root}/resolve?seed=3`);
    const r = await anon.get(`/api/w/${ids.root}/resolve?seed=3&lock=${lockParam({ ...base.body.lock, [other]: oh })}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(base.body);
  });

  it("전개 오류는 422와 코드(E_BUDGET: 100 × 101번 > 10000)", async () => {
    const many = (target: string) => Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, text: W(target) }));
    const m = await alice.create(doc("hundred", many(ids.leaf), { select: { count: [100, 100] } }));
    const t = await alice.create(doc("ten thousand", many(m), { select: { count: [100, 100] } }));
    expect((await anon.get(`/api/w/${m}/resolve?seed=1`)).status).toBe(200);
    const r = await anon.get(`/api/w/${t}/resolve?seed=1`);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "E_EXPAND", expand: { code: "E_BUDGET" } });
  });
});

describe("meta", () => {
  it("이름, 소유자, 최신 버전 번호", async () => {
    await alice.put(`/api/wildcards/${ids.leaf}`, { doc: doc("leaf v2", [{ id: "l1", text: "x" }]) });
    const r = await anon.get(`/api/w/${ids.leaf}/meta`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: ids.leaf, name: "leaf v2", owner: "alice", version: 2, hash: contentHash(doc("leaf v2", [{ id: "l1", text: "x" }])) });
    expect((await anon.get(`/api/w/AAAAAAAAAAAA/meta`)).status).toBe(404);
  });
});
