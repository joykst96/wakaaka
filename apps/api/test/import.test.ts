// 가져오기 (DESIGN 2절): 의존성 복사, forked_from, 복사본 재사용, 참조 ID 바꿔 쓰기, 이름 충돌, 결과 동일성.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expand } from "@wakaaka/core";
import { contentHash } from "@wakaaka/core/hash";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedExamples } from "../src/services/seed.ts";
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

async function bundleOf(c: Client, id: string) {
  const r = await c.get(`/api/w/${id}/bundle`);
  expect(r.status).toBe(200);
  return r.body;
}

/** 같은 seed에서 두 루트의 결과가 같은지 (seed 0..n-1과 큰 seed 몇 개) */
async function expectSameResults(a: string, b: string, n = 200) {
  const ba = await bundleOf(alice, a);
  const bb = await bundleOf(alice, b);
  const seeds = [...Array.from({ length: n }, (_, i) => String(i)), "9007199254740993", "18446744073709551615"];
  let nonEmpty = 0;
  for (const s of seeds) {
    const ra = expand(ba, s);
    const rb = expand(bb, s);
    expect(ra.ok && rb.ok, s).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(rb.text, `seed ${s}`).toBe(ra.text);
    if (ra.text !== "") nonEmpty++;
  }
  expect(nonEmpty).toBeGreaterThan(0);
}

/** bob: leaf ← mid(spread leaf, 인라인 leaf) ← root(ref mid, 선택지 안의 leaf) */
async function bobTree() {
  const leaf = await bob.create(doc("leaf", [{ id: "l1", text: "red", w: 2 }, { id: "l2", text: "blue" }, { id: "l3", text: "green", w: 0 }]));
  const mid = await bob.create(
    doc("mid", [{ id: "s", ref: { wildcard: leaf }, spread: true }, { id: "m1", text: `big ${W(leaf)} hat` }], { select: { count: [1, 2], sep: " + " } }),
  );
  const root = await bob.create(doc("root", [{ id: "r1", ref: { wildcard: mid }, w: 3 }, { id: "r2", text: `{plain|${W(leaf)} eyes|}, ${W(mid)}` }]), [7]);
  return { leaf, mid, root };
}

describe("가져오기", () => {
  it("의존성까지 내 것으로 복사하고 참조를 바꿔 쓰며 결과가 같다", async () => {
    const t = await bobTree();
    const r = await alice.post(`/api/wildcards/${t.root}/import`);
    expect(r.status).toBe(201);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.reused).toEqual([]);
    expect(r.body.created).toHaveLength(3);
    // 하위가 먼저 만들어진다
    expect(r.body.created.map((x: any) => x.forkedFrom.wildcard)).toEqual([t.leaf, t.mid, t.root]);
    const ids = new Map<string, string>(r.body.created.map((x: any) => [x.forkedFrom.wildcard, x.id]));
    expect(r.body.root).toBe(ids.get(t.root));

    // forked_from과 소유자
    const copy = await alice.get(`/api/wildcards/${r.body.root}`);
    const orig = await bob.get(`/api/wildcards/${t.root}`);
    expect(copy.body).toMatchObject({ owner: "alice", version: 1, categories: [7], forkedFrom: { wildcard: t.root, hash: orig.body.hash } });

    // 참조는 복사본 ID로, 항목 ID와 나머지는 그대로
    const mid = ids.get(t.mid)!;
    const leaf = ids.get(t.leaf)!;
    expect(copy.body.doc).toEqual(doc("root", [{ id: "r1", ref: { wildcard: mid }, w: 3 }, { id: "r2", text: `{plain|${W(leaf)} eyes|}, ${W(mid)}` }]));
    // 하위 참조가 없는 문서는 내용이 같아 해시도 같다(이름이 겹치지 않을 때)
    expect((await alice.get(`/api/wildcards/${leaf}`)).body.hash).toBe((await bob.get(`/api/wildcards/${t.leaf}`)).body.hash);

    // 묶음의 와일드카드는 모두 내 것
    const b = await bundleOf(alice, r.body.root);
    expect(Object.keys(b.lock).sort()).toEqual([...ids.values()].sort());

    await expectSameResults(t.root, r.body.root);
  });

  it("가져온 뒤 원작자가 고쳐도 내 것은 그대로, 내가 고쳐도 원본은 그대로", async () => {
    const t = await bobTree();
    const r = await alice.post(`/api/wildcards/${t.root}/import`);
    const myLeaf = r.body.created[0].id;
    const before = await bundleOf(alice, r.body.root);
    await bob.put(`/api/wildcards/${t.leaf}`, { doc: doc("leaf", [{ id: "l1", text: "CHANGED" }]) });
    expect(await bundleOf(alice, r.body.root)).toEqual(before);
    await alice.put(`/api/wildcards/${myLeaf}`, { doc: doc("leaf", [{ id: "l1", text: "mine" }]) });
    expect((await bob.get(`/api/wildcards/${t.leaf}`)).body.doc.items[0].text).toBe("CHANGED");
  });

  it("다이아몬드 의존은 한 번만 복사한다", async () => {
    const d = await bob.create(doc("D", [{ id: "d", text: "base" }]));
    const b = await bob.create(doc("B", [{ id: "b", text: `b ${W(d)}` }]));
    const c = await bob.create(doc("C", [{ id: "c", ref: { wildcard: d } }]));
    const root = await bob.create(doc("R", [{ id: "x", text: `${W(b)} ${W(c)} ${W(d)}` }]));
    const r = await alice.post(`/api/wildcards/${root}/import`);
    expect(r.body.created).toHaveLength(4);
    expect(new Set(r.body.created.map((x: any) => x.forkedFrom.wildcard))).toEqual(new Set([d, b, c, root]));
    expect(r.body.created[0].forkedFrom.wildcard).toBe(d);
    await expectSameResults(root, r.body.root);
  });

  it("이미 있는 복사본은 다시 쓴다. 옛 버전이거나 내가 고친 것이어도 그대로", async () => {
    const t = await bobTree();
    const first = await alice.post(`/api/wildcards/${t.mid}/import`);
    expect(first.body.created).toHaveLength(2);
    const myLeaf = first.body.created[0].id;
    const myMid = first.body.root;

    // 같은 것을 다시 가져오면 아무것도 만들지 않는다
    const again = await alice.post(`/api/wildcards/${t.mid}/import`);
    expect(again.body).toMatchObject({ root: myMid, created: [] });
    expect(again.body.reused).toEqual([{ id: myMid, name: "mid", forkedFrom: t.mid }]);

    // 내 leaf 복사본을 고치고, 원작자도 leaf를 고친 뒤 root를 가져오면 mid 복사본을 다시 쓰고 root만 만든다
    await alice.put(`/api/wildcards/${myLeaf}`, { doc: doc("leaf", [{ id: "l1", text: "MY EDIT" }]) });
    await bob.put(`/api/wildcards/${t.leaf}`, { doc: doc("leaf", [{ id: "l1", text: "BOB EDIT" }]) });
    const r = await alice.post(`/api/wildcards/${t.root}/import`);
    expect(r.body.created.map((x: any) => x.forkedFrom.wildcard)).toEqual([t.root]);
    expect(r.body.reused.map((x: any) => x.id).sort()).toEqual([myLeaf, myMid].sort());
    const b = await bundleOf(alice, r.body.root);
    expect(JSON.stringify(b)).toContain("MY EDIT");
    expect(JSON.stringify(b)).not.toContain("BOB EDIT");
  });

  it("지운 복사본은 다시 쓰지 않고 새로 만든다", async () => {
    const t = await bobTree();
    const first = await alice.post(`/api/wildcards/${t.leaf}/import`);
    await alice.del(`/api/wildcards/${first.body.root}`);
    const again = await alice.post(`/api/wildcards/${t.leaf}/import`);
    expect(again.body.created).toHaveLength(1);
    expect(again.body.root).not.toBe(first.body.root);
  });

  it("이름이 겹치면 ' (원작자)', 그래도 겹치면 번호. 64자를 넘으면 원래 이름을 자른다", async () => {
    await alice.create(doc("leaf", []));
    await alice.create(doc("LEAF (bob)", []));
    const long = "가".repeat(64);
    await alice.create(doc(long, []));
    const t = await bobTree();
    const l = await bob.create(doc(long, [{ id: "a", text: "x" }]));
    const r = await alice.post(`/api/wildcards/${t.leaf}/import`);
    expect(r.body.created[0].name).toBe("leaf (bob) 2");
    const r2 = await alice.post(`/api/wildcards/${l}/import`);
    expect(r2.body.created[0].name).toBe("가".repeat(58) + " (bob)");
    // 이름이 바뀐 복사본은 해시가 원본과 다르지만 결과는 같다
    expect(r.body.created[0].forkedFrom.hash).not.toBe((await alice.get(`/api/wildcards/${r.body.root}`)).body.hash);
    await expectSameResults(t.leaf, r.body.root);
  });

  it("dryRun은 결과만 돌려주고 아무것도 남기지 않는다", async () => {
    const t = await bobTree();
    const r = await alice.post(`/api/wildcards/${t.root}/import?dryRun=1`);
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.created).toHaveLength(3);
    expect((await alice.get("/api/wildcards")).body.wildcards).toEqual([]);
    expect((await alice.get(`/api/wildcards/${r.body.root}`)).status).toBe(404);
  });

  it("내 것, 지운 것, 없는 것은 가져올 수 없다", async () => {
    const mine = await alice.create(doc("mine", []));
    expect((await alice.post(`/api/wildcards/${mine}/import`)).body.error.code).toBe("E_IMPORT_OWN");
    const t = await bobTree();
    await bob.put(`/api/wildcards/${t.root}`, { doc: doc("root", []) });
    await bob.put(`/api/wildcards/${t.mid}`, { doc: doc("mid", []) });
    await bob.del(`/api/wildcards/${t.leaf}`);
    expect((await alice.post(`/api/wildcards/${t.leaf}/import`)).status).toBe(404);
    expect((await alice.post(`/api/wildcards/AAAAAAAAAAAA/import`)).status).toBe(404);
  });

  it("복사본도 일반 저장 검증을 거친다(깊이 경고가 전달된다)", async () => {
    let prev = await bob.create(doc("d0", [{ id: "a", text: "leaf" }]));
    for (let i = 1; i <= 17; i++) prev = await bob.create(doc(`d${i}`, [{ id: "a", text: W(prev) }]));
    const r = await alice.post(`/api/wildcards/${prev}/import`);
    expect(r.status).toBe(201);
    const top = r.body.created.at(-1);
    expect(top.warnings).toEqual([{ code: "W_DEPTH", wildcard: top.id, depth: 17 }]);
  });
});

describe("예시 와일드카드로 가져오기", () => {
  let examples: unknown;
  beforeAll(() => {
    const root = new URL("../../../", import.meta.url);
    execFileSync(process.execPath, [new URL("fixtures/tools/build-examples.ts", root).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { stdio: "pipe" });
    examples = JSON.parse(readFileSync(new URL("fixtures/out/examples.json", root), "utf8"));
  });

  it("scene preset(42개 중 루트)을 가져오면 같은 seed에서 원본과 같다", async () => {
    const names = await seedExamples(env.db, examples, "sample");
    expect(names.size).toBe(42);
    const scene = names.get("scene preset")!;
    const sample = new Client(env); // 로그인하지 않은 조회
    const orig = await sample.get(`/api/w/${scene}/bundle`);
    const nOrig = Object.keys(orig.body.lock).length;
    expect(nOrig).toBeGreaterThan(20);

    const r = await alice.post(`/api/wildcards/${scene}/import`);
    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(nOrig);
    expect(r.body.created.every((x: any) => x.warnings.length === 0)).toBe(true);
    await expectSameResults(scene, r.body.root, 300);

    // 하위 참조가 없는 문서는 복사본 해시가 원본 해시와 같고, 참조가 있는 문서는 다르다
    const mine = (await alice.get("/api/wildcards")).body.wildcards as Array<{ id: string; hash: string; forkedFrom: { hash: string } }>;
    expect(mine).toHaveLength(nOrig);
    const leaves = Object.values(orig.body.docs as Record<string, any>).filter((d) => !JSON.stringify(d).includes("${w:") && !JSON.stringify(d).includes('"ref"'));
    const same = mine.filter((w) => w.hash === w.forkedFrom.hash);
    expect(same.length).toBe(leaves.length);
    expect(same.length).toBeGreaterThan(10);

    // 다른 예시(accessories, outfit)를 가져오면 이미 있는 복사본을 다시 쓴다
    const acc = await alice.post(`/api/wildcards/${names.get("accessories")!}/import`);
    expect(acc.body.created).toEqual([]);
    expect(acc.body.reused).toHaveLength(1);
  });

  it("시드한 예시 문서의 해시는 core contentHash와 같다", async () => {
    const names = await seedExamples(env.db, examples, "sample");
    const hair = await new Client(env).get(`/api/wildcards/${names.get("hair color")!}`);
    expect(hair.body.hash).toBe(contentHash(hair.body.doc));
  });
});
