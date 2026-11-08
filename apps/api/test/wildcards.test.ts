import { contentHash } from "@wakaaka/core/hash";
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

const hair = doc("hair color", [
  { id: "a1", text: "red hair", w: 3 },
  { id: "a2", text: "blue hair" },
]);

describe("생성과 조회", () => {
  it("만들면 서버가 해시를 계산하고 v1이 된다", async () => {
    const r = await alice.post("/api/wildcards", { doc: hair, categories: [4, 4, 1] });
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(r.body.seq).toBe(1);
    expect(r.body.hash).toBe(contentHash(hair));
    expect(r.body.warnings).toEqual([]);

    const g = await new Client(env).get(`/api/wildcards/${r.body.id}`); // 로그인 없이 조회
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ id: r.body.id, name: "hair color", owner: "alice", version: 1, hash: r.body.hash, categories: [1, 4], forkedFrom: null });
    expect(g.body.doc).toEqual(hair);
  });

  it("DB에는 정규화(JCS) 결과가 들어간다", async () => {
    const id = await alice.create({ items: [{ text: "x", id: "b" }], name: "n", schema: 1 });
    const row = await env.db.selectFrom("wc_content").selectAll().executeTakeFirstOrThrow();
    expect(row.size).toBe(Buffer.byteLength('{"items":[{"id":"b","text":"x"}],"name":"n","schema":1}'));
    expect((await alice.get(`/api/wildcards/${id}`)).body.hash).toBe(row.hash);
  });

  it("클라이언트가 보낸 해시나 ID는 받지 않는다", async () => {
    const r = await alice.post("/api/wildcards", { doc: hair, hash: "AAAAAAAAAAAA" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("E_SCHEMA");
  });

  it("목록은 내 것만", async () => {
    await alice.create(hair);
    const bob = await new Client(env).signup("bob");
    await bob.create(doc("x", []));
    const l = await alice.get("/api/wildcards");
    expect(l.body.wildcards.map((w: any) => w.name)).toEqual(["hair color"]);
    expect((await new Client(env).get("/api/wildcards")).status).toBe(401);
  });

  it("없는 ID, 형식이 틀린 ID는 404", async () => {
    expect((await alice.get("/api/wildcards/AAAAAAAAAAAA")).status).toBe(404);
    expect((await alice.get("/api/wildcards/short")).status).toBe(404);
  });
});

describe("선택지 보기 가중치 (SPEC 2.2 규칙 0)", () => {
  it("{3*a|b}는 저장되고 resolve가 가중치대로 뽑는다, 틀린 가중치는 E_SYNTAX(E_CHOICE_WEIGHT)", async () => {
    const id = await alice.create(doc("tint", [{ id: "a", text: "{3*silver|platinum} hair" }]));
    const counts = new Map<string, number>();
    for (let s = 0; s < 200; s++) {
      const r = await alice.get(`/api/w/${id}/resolve?seed=${s}`);
      counts.set(r.body.text, (counts.get(r.body.text) ?? 0) + 1);
    }
    expect(counts.get("silver hair")! / counts.get("platinum hair")!).toBeGreaterThan(2);
    for (const text of ["{1.5*a|b}", "{0*a|0*b}", "{1000001*a}"]) {
      const r = await alice.post("/api/wildcards", { doc: doc("bad" + text.length, [{ id: "a", text }]) });
      expect(r.status, text).toBe(400);
      expect(r.body.error.code).toBe("E_SYNTAX");
      expect(r.body.error.syntax.code).toBe("E_CHOICE_WEIGHT");
    }
  });
});

describe("새 버전과 이력", () => {
  it("저장할 때마다 버전이 늘고 이력이 남는다. 같은 내용이면 버전을 만들지 않는다", async () => {
    const id = await alice.create(hair);
    const v2doc = doc("hair color", [...hair.items, { id: "a3", text: "pink hair" }]);
    const r2 = await alice.put(`/api/wildcards/${id}`, { doc: v2doc });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ seq: 2, unchanged: false, hash: contentHash(v2doc) });
    const r3 = await alice.put(`/api/wildcards/${id}`, { doc: v2doc, categories: [5] });
    expect(r3.body).toMatchObject({ seq: 2, unchanged: true });
    const g = await alice.get(`/api/wildcards/${id}`);
    expect(g.body.categories).toEqual([5]);

    const v = await alice.get(`/api/wildcards/${id}/versions`);
    expect(v.body.versions.map((x: any) => x.seq)).toEqual([2, 1]);
    const old = await alice.get(`/api/wildcards/${id}?v=1`);
    expect(old.body.doc).toEqual(hair);
    expect(old.body.version).toBe(2);
    expect(old.body.seq).toBe(1);
    expect((await alice.get(`/api/wildcards/${id}?v=9`)).status).toBe(404);
    expect((await alice.get(`/api/wildcards/${id}?v=0`)).status).toBe(400);
  });

  it("이름을 바꾸면 와일드카드 이름도 바뀐다", async () => {
    const id = await alice.create(hair);
    await alice.put(`/api/wildcards/${id}`, { doc: { ...hair, name: "Hair" } });
    expect((await alice.get(`/api/wildcards/${id}`)).body.name).toBe("Hair");
  });
});

describe("이름 규칙", () => {
  it("필수, 1~64자, 앞뒤 공백 거부, 금지 글자", async () => {
    const bad: unknown[] = [undefined, "", "   ", " a", "a ", "a\t", "x".repeat(65), "a{b", "a:b", "a=b"];
    for (const name of bad) {
      const r = await alice.post("/api/wildcards", { doc: { schema: 1, items: [], ...(name === undefined ? {} : { name }) } });
      expect(r.status, JSON.stringify(name)).toBe(400);
      expect(["E_NAME", "E_SCHEMA"]).toContain(r.body.error.code);
    }
    // 코드 포인트로 센다
    expect((await alice.post("/api/wildcards", { doc: doc("😀".repeat(64), []) })).status).toBe(201);
    expect((await alice.post("/api/wildcards", { doc: doc("가".repeat(64), []) })).status).toBe(201);
  });

  it("소유자 안에서 대소문자 무시 유일, 다른 사람과는 겹쳐도 된다", async () => {
    await alice.create(doc("Hair", []));
    const r = await alice.post("/api/wildcards", { doc: doc("hAIR", []) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("E_NAME_TAKEN");
    const bob = await new Client(env).signup("bob");
    await bob.create(doc("hair", []));
    // 새 버전에서 남의 이름(내 다른 와일드카드)으로 바꾸는 것도 막는다
    const id = await alice.create(doc("other", []));
    expect((await alice.put(`/api/wildcards/${id}`, { doc: doc("HAIR", []) })).status).toBe(409);
  });

  it("지운 것의 이름은 다시 쓸 수 있다", async () => {
    const id = await alice.create(doc("temp", []));
    expect((await alice.del(`/api/wildcards/${id}`)).status).toBe(200);
    expect((await alice.post("/api/wildcards", { doc: doc("TEMP", []) })).status).toBe(201);
  });
});

describe("저장 검증", () => {
  it("문법 오류는 항목 ID와 위치를 알려 주고 거부", async () => {
    const r = await alice.post("/api/wildcards", { doc: doc("x", [{ id: "ok", text: "fine" }, { id: "bad", text: "a {b" }]) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "E_SYNTAX", item: "bad", syntax: { code: "E_UNCLOSED_CHOICE", start: 2, end: 3 } });
  });

  it("이름 참조가 남은 문서는 거부(E_REF_NAME)", async () => {
    const r = await alice.post("/api/wildcards", { doc: doc("x", [{ id: "a", text: "${hair}" }]) });
    expect(r.body.error).toMatchObject({ code: "E_SYNTAX", syntax: { code: "E_REF_NAME" } });
  });

  it("참조는 내 지우지 않은 와일드카드만", async () => {
    const bob = await new Client(env).signup("bob");
    const bobs = await bob.create(doc("bob's", [{ id: "a", text: "b" }]));
    for (const d of [
      doc("x", [{ id: "a", text: `with ${W(bobs)}` }]),
      doc("x", [{ id: "a", ref: { wildcard: bobs } }]),
      doc("x", [{ id: "a", text: `{a|${W("ZZZZZZZZZZZZ")}}` }]),
    ]) {
      const r = await alice.post("/api/wildcards", { doc: d });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: "E_REF_NOT_FOUND", item: "a" });
    }
    const gone = await alice.create(doc("gone", [{ id: "a", text: "g" }]));
    await alice.del(`/api/wildcards/${gone}`);
    expect((await alice.post("/api/wildcards", { doc: doc("x", [{ id: "a", text: W(gone) }]) })).body.error.code).toBe("E_REF_NOT_FOUND");
  });

  it("순환은 거부하고 경로를 알려 준다", async () => {
    const a = await alice.create(doc("A", [{ id: "a", text: "leaf" }]));
    const b = await alice.create(doc("B", [{ id: "b", text: W(a) }]));
    const c = await alice.create(doc("C", [{ id: "c", ref: { wildcard: b } }]));
    const r = await alice.put(`/api/wildcards/${a}`, { doc: doc("A", [{ id: "a", text: `{x|${W(c)}}` }]) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "E_CYCLE", path: [a, c, b, a] });
    // 자기 자신
    const s = await alice.put(`/api/wildcards/${a}`, { doc: doc("A", [{ id: "a", text: W(a) }]) });
    expect(s.body.error).toMatchObject({ code: "E_CYCLE", path: [a, a] });
  });

  it("가중치 합 0: 후보가 있으면 거부, 빈 문서는 받는다, spread 대상까지 본다", async () => {
    const zero = await alice.post("/api/wildcards", { doc: doc("z", [{ id: "a", text: "x", w: 0 }]) });
    expect(zero.body.error.code).toBe("E_WEIGHT_ZERO");
    expect((await alice.post("/api/wildcards", { doc: doc("empty", []) })).status).toBe(201);

    const inner = await alice.create(doc("inner", [{ id: "i", text: "x", w: 0 }, { id: "j", text: "y" }]));
    const emptyPool = await alice.create(doc("emptypool", []));
    // spread로 펼친 후보 [i(0), j(1)] + 0 → 합 1이라 받는다
    const outer = await alice.create(doc("outer", [{ id: "s", ref: { wildcard: inner }, spread: true }, { id: "o", text: "z", w: 0 }]));
    // 빈 대상만 펼치면 후보 0개라 받는다
    expect((await alice.post("/api/wildcards", { doc: doc("onlyempty", [{ id: "s", ref: { wildcard: emptyPool }, spread: true }]) })).status).toBe(201);
    // ref 항목(spread 아님)은 자기 w만 본다
    expect((await alice.post("/api/wildcards", { doc: doc("refzero", [{ id: "r", ref: { wildcard: inner }, w: 0 }]) })).body.error.code).toBe("E_WEIGHT_ZERO");

    // spread 대상을 비워 outer의 후보가 o(0)만 남으면, 대상 저장은 받고 outer에 대한 경고
    const r = await alice.put(`/api/wildcards/${inner}`, { doc: doc("inner", []) });
    expect(r.status).toBe(200);
    expect(r.body.warnings).toEqual([{ code: "W_WEIGHT_ZERO", wildcard: outer }]);
  });

  it("깊이 16을 넘으면 경고만 하고 저장한다. 그 위의 와일드카드에도 경고", async () => {
    let prev = await alice.create(doc("d0", [{ id: "a", text: "leaf" }]));
    const ids = [prev];
    for (let i = 1; i <= 16; i++) {
      prev = await alice.create(doc(`d${i}`, [{ id: "a", text: W(prev) }]));
      ids.push(prev);
    }
    const top = await alice.post("/api/wildcards", { doc: doc("d17", [{ id: "a", text: W(prev) }]) });
    expect(top.status).toBe(201);
    expect(top.body.warnings).toEqual([{ code: "W_DEPTH", wildcard: top.body.id, depth: 17 }]);
    // 바닥을 한 칸 깊게 하면 위의 둘이 경고를 받는다
    const leaf2 = await alice.create(doc("leaf2", [{ id: "a", text: "x" }]));
    const r = await alice.put(`/api/wildcards/${ids[0]}`, { doc: doc("d0", [{ id: "a", text: W(leaf2) }]) });
    expect(r.body.warnings).toEqual(
      expect.arrayContaining([
        { code: "W_DEPTH", wildcard: ids[16], depth: 17 },
        { code: "W_DEPTH", wildcard: top.body.id, depth: 18 },
      ]),
    );
    expect(r.body.warnings).toHaveLength(2);
    // 저장은 됐지만 전개는 E_DEPTH
    const res = await alice.get(`/api/w/${top.body.id}/resolve?seed=1`);
    expect(res.status).toBe(422);
    expect(res.body.error.expand.code).toBe("E_DEPTH");
  });

  it("문서 256KB 초과는 거부(본문 크기 제한 → 413)", async () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, text: "x".repeat(1000) }));
    const r = await alice.post("/api/wildcards", { doc: doc("big", items) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("E_TOO_LARGE");
  });

  it("묶음 2MB를 넘으면 경고", async () => {
    const big = () => Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, text: "y".repeat(1200) }));
    const parts: string[] = [];
    for (let i = 0; i < 9; i++) parts.push(await alice.create(doc(`part${i}`, big())));
    const r = await alice.post("/api/wildcards", { doc: doc("all", parts.map((p, i) => ({ id: `p${i}`, ref: { wildcard: p } }))) });
    expect(r.status).toBe(201);
    expect(r.body.warnings).toHaveLength(1);
    expect(r.body.warnings[0]).toMatchObject({ code: "W_BUNDLE_SIZE", wildcard: r.body.id });
  });
});

describe("주석 항목 (SPEC 2.7)", () => {
  it("주석 안의 깨진 문법·남의 참조·이름 참조·자기 참조는 검사하지 않고, 참조로 치지 않으며, 결과에 나오지 않는다", async () => {
    const bob = await new Client(env).signup("bob");
    const bobs = await bob.create(doc("bob's", [{ id: "a", text: "b" }]));
    const leaf = await alice.create(doc("leaf", [{ id: "l", text: "leaf" }]));
    const d = doc("noted", [
      { id: "c1", text: `# 메모 {깨진 ${W(bobs)} \${hair} ${W("ZZZZZZZZZZZZ")}`, w: 9 },
      { id: "c2", text: `#${W(leaf)}` },
      { id: "a", text: "red hair" },
      { id: "b", text: "\\#compass" },
    ]);
    const r = await alice.post("/api/wildcards", { doc: d });
    expect(r.status).toBe(201);
    expect(r.body.hash).toBe(contentHash(d)); // 주석도 내용이라 해시에 들어간다
    // 자기 자신을 가리키는 주석도 순환이 아니다
    const self = await alice.put(`/api/wildcards/${r.body.id}`, { doc: doc("noted", [...d.items, { id: "c3", text: `# ${W(r.body.id)}` }]) });
    expect(self.status).toBe(200);
    // 주석 안의 참조는 의존이 아니다: leaf를 지울 수 있다
    expect((await alice.get(`/api/wildcards/${leaf}/dependents`)).body.dependents).toEqual([]);
    expect((await alice.del(`/api/wildcards/${leaf}`)).status).toBe(200);
    const seen = new Set<string>();
    for (let s = 0; s < 40; s++) seen.add((await alice.get(`/api/w/${r.body.id}/resolve?seed=${s}`)).body.text);
    expect([...seen].sort()).toEqual(["#compass", "red hair"]);
  });

  it("가중치 합 0은 주석을 빼고 본다, 주석만 있는 문서는 빈 와일드카드처럼 받는다", async () => {
    const zero = await alice.post("/api/wildcards", { doc: doc("z", [{ id: "c", text: "# 설명" }, { id: "a", text: "x", w: 0 }]) });
    expect(zero.body.error.code).toBe("E_WEIGHT_ZERO");
    const only = await alice.post("/api/wildcards", { doc: doc("notes", [{ id: "c", text: "# 아직 비어 있음", w: 0 }]) });
    expect(only.status).toBe(201);
    expect((await alice.get(`/api/w/${only.body.id}/resolve?seed=1`)).body.text).toBe("");
    // spread 대상의 주석도 후보가 아니다
    const inner = await alice.create(doc("inner", [{ id: "c", text: "# x" }, { id: "i", text: "x" }]));
    const outer = await alice.create(doc("outer", [{ id: "s", ref: { wildcard: inner }, spread: true }, { id: "o", text: "z", w: 0 }]));
    const r = await alice.put(`/api/wildcards/${inner}`, { doc: doc("inner", [{ id: "c", text: "# x" }]) });
    expect(r.status).toBe(200);
    expect(r.body.warnings).toEqual([{ code: "W_WEIGHT_ZERO", wildcard: outer }]);
  });

  it("내보내기(/export)는 주석을 빼고 주석 없는 문서와 같다. 저장 문서·노드 묶음·해시는 주석을 포함한다", async () => {
    const leaf = await alice.create(doc("leaf", [{ id: "c", text: "# 잎 메모" }, { id: "l", text: "leaf" }, { id: "m", text: "{x|y}" }]));
    const items = [{ id: "c", text: `# 메모 ${W(leaf)} {깨진` }, { id: "a", text: `red ${W(leaf)}`, w: 2 }, { id: "b", text: "\\#compass" }];
    const noted = await alice.create(doc("noted", items));
    const plainLeaf = await alice.create(doc("leaf2", [{ id: "l", text: "leaf" }, { id: "m", text: "{x|y}" }]));
    const plain = await alice.create(doc("plain", [{ id: "a", text: `red ${W(plainLeaf)}`, w: 2 }, { id: "b", text: "\\#compass" }]));
    const ex = await alice.get(`/api/w/${noted}/export?format=impact`);
    expect(ex.status).toBe(200);
    expect(ex.body.text).not.toContain("메모");
    expect(ex.body.text).toBe((await alice.get(`/api/w/${plain}/export?format=impact`)).body.text);
    // 전개 결과도 주석을 뺀 문서와 같다
    for (let s = 0; s < 20; s++) {
      expect((await alice.get(`/api/w/${noted}/resolve?seed=${s}`)).body.text).toBe((await alice.get(`/api/w/${plain}/resolve?seed=${s}`)).body.text);
    }
    // 편집기가 다시 여는 저장 문서에는 주석이 남는다
    expect((await alice.get(`/api/wildcards/${noted}`)).body.doc.items).toEqual(items);
    // 노드용 묶음은 문서를 바꾸지 않는다: 주석이 있고, 키가 내용 해시와 맞는다
    const b = (await alice.get(`/api/w/${noted}/bundle`)).body;
    for (const [h, d] of Object.entries(b.docs)) expect(contentHash(d as never), h).toBe(h);
    expect(JSON.stringify(b.docs)).toContain("# 메모");
    expect(JSON.stringify(b.docs)).toContain("# 잎 메모");
  });

  it("가져오기: 주석은 그대로 복사하고(참조 ID를 바꾸지 않음) 결과가 원본과 같다", async () => {
    const leaf = await alice.create(doc("leaf", [{ id: "l", text: "leaf" }]));
    const root = await alice.create(doc("root", [{ id: "c", text: `# 원래 ${W(leaf)} {깨진` }, { id: "a", text: `x ${W(leaf)}` }]));
    const bob = await new Client(env).signup("bob");
    const r = await bob.post(`/api/wildcards/${root}/import`);
    expect(r.status).toBe(201);
    const copy = (await bob.get(`/api/wildcards/${r.body.root}`)).body.doc;
    expect(copy.items[0].text).toBe(`# 원래 ${W(leaf)} {깨진`);
    expect(copy.items[1].text).not.toContain(leaf);
    for (let s = 0; s < 5; s++) {
      expect((await bob.get(`/api/w/${r.body.root}/resolve?seed=${s}`)).body.text).toBe((await alice.get(`/api/w/${root}/resolve?seed=${s}`)).body.text);
    }
  });
});

describe("dependents와 삭제", () => {
  it("dependents는 최신 버전 기준 직접·간접 참조와 거리", async () => {
    const a = await alice.create(doc("A", [{ id: "a", text: "x" }]));
    const b = await alice.create(doc("B", [{ id: "b", text: W(a) }]));
    const c = await alice.create(doc("C", [{ id: "c", ref: { wildcard: b } }, { id: "d", text: W(a) }]));
    const r = await new Client(env).get(`/api/wildcards/${a}/dependents`);
    expect(r.body.dependents).toEqual([
      { id: b, name: "B", depth: 1 },
      { id: c, name: "C", depth: 1 },
    ]);
    expect((await alice.get(`/api/wildcards/${b}/dependents`)).body.dependents).toEqual([{ id: c, name: "C", depth: 1 }]);
    // 옛 버전의 참조는 세지 않는다
    await alice.put(`/api/wildcards/${c}`, { doc: doc("C", [{ id: "c", ref: { wildcard: b } }]) });
    expect((await alice.get(`/api/wildcards/${a}/dependents`)).body.dependents).toEqual([
      { id: b, name: "B", depth: 1 },
      { id: c, name: "C", depth: 2 },
    ]);
  });

  it("최신 버전이 참조하면 지울 수 없고, 참조를 다 고치면 지울 수 있다(옛 버전은 막지 않음)", async () => {
    const a = await alice.create(doc("A", [{ id: "a", text: "x" }]));
    const b = await alice.create(doc("B", [{ id: "b", text: W(a) }]));
    const r = await alice.del(`/api/wildcards/${a}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "E_IN_USE", dependents: [{ id: b, name: "B" }] });
    const lockedRes = await alice.get(`/api/w/${b}/resolve?seed=0`);
    const lock = Object.entries(lockedRes.body.lock).map(([k, v]) => `${k}:${v}`).sort().join(",");

    await alice.put(`/api/wildcards/${b}`, { doc: doc("B", [{ id: "b", text: "no ref" }]) });
    expect((await alice.del(`/api/wildcards/${a}`)).status).toBe(200);
    // 지운 것은 조회, 이력, 노드용 모두 404
    for (const p of [`/api/wildcards/${a}`, `/api/wildcards/${a}/versions`, `/api/w/${a}/bundle`, `/api/w/${a}/meta`, `/api/w/${a}/resolve?seed=0`]) {
      expect((await alice.get(p)).status, p).toBe(404);
    }
    // 지운 것이 든 옛 lock도 404 (사용자 결정)
    const old = await alice.get(`/api/w/${b}/resolve?seed=0&lock=${lock}`);
    expect(old.status).toBe(404);
    expect(old.body.error.wildcard).toBe(a);
    // 옛 버전 문서는 볼 수 있다
    expect((await alice.get(`/api/wildcards/${b}?v=1`)).body.doc.items[0].text).toBe(W(a));
    // 옛 내용을 다시 저장하면 참조 검증에 걸린다
    expect((await alice.put(`/api/wildcards/${b}`, { doc: doc("B", [{ id: "b", text: W(a) }]) })).body.error.code).toBe("E_REF_NOT_FOUND");
  });
});
