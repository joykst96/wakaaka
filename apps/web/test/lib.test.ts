// 경로·링크 검증, 편집 문서 변환, 이름 참조, 미리보기 묶음, 임시 보관

import { docSchema, expand } from "@wakaaka/core";
import { describe, expect, test } from "vitest";
import { fromDoc, newItemId, sameDoc, toDoc } from "../src/lib/editdoc.ts";
import { clearDraft, loadDraft, loadFlag, saveDraft, saveFlag, type KeyValueStore } from "../src/lib/drafts.ts";
import { mineByName, nameKey, nameRefs, rewriteNames } from "../src/lib/names.ts";
import { buildPreviewBundle, dependencyTree, directRefs, DRAFT_KEY, parseSeed, previewSeeds, segments } from "../src/lib/preview.ts";
import { hrefOf, parseRoute } from "../src/lib/routes.ts";

describe("경로와 링크 (DESIGN 9절 7항)", () => {
  test("경로 해석", () => {
    expect(parseRoute("/")).toEqual({ name: "explore" });
    expect(parseRoute("/w/abcdefghijkl")).toEqual({ name: "wildcard", id: "abcdefghijkl" });
    expect(parseRoute("/u/joy_96")).toEqual({ name: "user", username: "joy_96" });
    for (const p of ["/w/short", "/w/abcdefghijk!", "/w/abcdefghijkl/x", "/u/a", "/u/javascript:alert(1)", "/u/%3Cscript%3E", "/x"]) {
      expect(parseRoute(p), p).toEqual({ name: "notFound" });
    }
  });

  test("href는 검증한 ID·아이디로만 만들고, 아니면 /", () => {
    expect(hrefOf({ name: "wildcard", id: "abcdefghijkl" })).toBe("/w/abcdefghijkl");
    expect(hrefOf({ name: "user", username: "bob" })).toBe("/u/bob");
    for (const id of ["javascript:alert(1)", "//evil.example", "abcdefghijkl/../../x", "abcdefghijk\u0000", ""]) {
      expect(hrefOf({ name: "wildcard", id }), id).toBe("/");
    }
    for (const username of ["javascript:alert(1)", "//evil", "a b", "<x>", "a".repeat(33)]) {
      expect(hrefOf({ name: "user", username }), username).toBe("/");
    }
  });
});

describe("편집 문서 ↔ 저장 문서", () => {
  test("필드가 있는지 없는지를 지킨다 (해시가 바뀌지 않게)", () => {
    const docs = [
      { schema: 1 as const, name: "a", items: [{ id: "x", text: "t" }] },
      { schema: 1 as const, name: "a", select: { count: [1, 1] as [number, number], sep: ", " }, items: [{ id: "x", text: "t", w: 1 }] },
      { schema: 1 as const, name: "a", description: "d", select: { sep: " | " }, items: [{ id: "x", ref: { wildcard: "abcdefghijkl" }, spread: true }, { id: "y", ref: { wildcard: "abcdefghijkl" }, spread: false, w: 2 }] },
    ];
    for (const d of docs) {
      expect(toDoc(fromDoc(d))).toEqual(d);
      expect(docSchema.safeParse(toDoc(fromDoc(d))).success).toBe(true);
    }
  });

  test("펼침 항목에는 w를 넣지 않는다, 빈 설명은 넣지 않는다", () => {
    const d = toDoc({ name: "a", description: "", items: [{ id: "x", ref: "abcdefghijkl", spread: true, w: 3 }] });
    expect(d).toEqual({ schema: 1, name: "a", items: [{ id: "x", ref: { wildcard: "abcdefghijkl" }, spread: true }] });
  });

  test("sameDoc", () => {
    expect(sameDoc({ name: "a", items: [] }, { name: "a", description: "", items: [] })).toBe(true);
    expect(sameDoc({ name: "a", items: [] }, { name: "a", sep: ", ", items: [] })).toBe(false);
  });

  test("newItemId는 base62이고 겹치지 않는다", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newItemId(taken);
      expect(id).toMatch(/^[0-9A-Za-z]{4,16}$/);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    // 4자 후보가 늘 겹치면 5자로
    expect(newItemId(new Set(["0000"]), (n) => new Uint8Array(n))).toBe("00000");
  });
});

describe("이름 참조 (DESIGN 11절)", () => {
  test("이름 참조 모으기: 대소문자 무시, 선택지 안 포함, 이스케이프는 참조가 아님", () => {
    const refs = nameRefs([
      { id: "a", text: "${Hair Color} and {${eye}|x}" },
      { id: "b", text: "${hair color} \\${not a ref}" },
      { id: "c", text: "{broken" },
      { id: "d", ref: "abcdefghijkl" },
    ]);
    expect([...refs]).toEqual([
      ["hair color", "Hair Color"],
      ["eye", "eye"],
    ]);
  });

  test("파서 위치로 바꾼다: 이스케이프한 \\${는 그대로", () => {
    const mine = mineByName([{ id: "AAAAAAAAAAAA", name: "Hair Color" }]);
    const resolve = (n: string) => mine.get(nameKey(n));
    expect(rewriteNames("x ${hair color}, \\${hair color}, {${ HAIR COLOR }|y}", resolve)).toBe("x ${w:AAAAAAAAAAAA}, \\${hair color}, {${w:AAAAAAAAAAAA}|y}");
    expect(rewriteNames("${unknown} ${Hair Color}", resolve)).toBe("${unknown} ${w:AAAAAAAAAAAA}");
    expect(rewriteNames("{broken ${Hair Color}", resolve)).toBe("{broken ${Hair Color}");
  });
});

describe("미리보기 묶음", () => {
  const child = { format: 1 as const, root: "childHash001", lock: { CHILDchild01: "childHash001" }, docs: { childHash001: { schema: 1 as const, name: "child", items: [{ id: "x", text: "long" }, { id: "y", text: "short" }] } } };

  test("하위 묶음을 합쳐 core expand로 전개한다", () => {
    const doc = { schema: 1 as const, name: "me", items: [{ id: "a", text: "${w:CHILDchild01} hair" }] };
    expect(directRefs(doc)).toEqual(["CHILDchild01"]);
    const b = buildPreviewBundle(doc, [child], "SELFselfself");
    expect(b.root).toBe(DRAFT_KEY);
    const r = expand(b, "0", { rootWildcard: "SELFselfself" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toMatch(/^(long|short) hair$/);
      expect(r.sources.map((s) => s.wildcard)).toEqual(["SELFselfself", "CHILDchild01"]);
    }
  });

  test("자기 자신을 참조하면 E_CYCLE", () => {
    const doc = { schema: 1 as const, name: "me", items: [{ id: "a", text: "${w:SELFselfself}" }] };
    const r = expand(buildPreviewBundle(doc, [], "SELFselfself"), "0");
    expect(r.ok ? "ok" : r.error.code).toBe("E_CYCLE");
  });

  test("seed: 범위 검사와 다섯 개, 2^64−1 다음은 0", () => {
    expect(parseSeed("18446744073709551615")).toBe(18446744073709551615n);
    for (const s of ["18446744073709551616", "-1", "1.5", "", "1e3", "0x10"]) expect(parseSeed(s), s).toBeNull();
    expect(previewSeeds(18446744073709551614n)).toEqual([18446744073709551614n, 18446744073709551615n, 0n, 1n, 2n]);
  });

  test("출처 조각: 가장 안쪽 범위", () => {
    const text = "1girl, long hair";
    const sources = [
      { start: 0, end: 16, hash: "r", wildcard: null, item: "a" },
      { start: 7, end: 11, hash: "c", wildcard: "C", item: "x" },
    ];
    expect(segments(text, sources)).toEqual([
      { start: 0, end: 7, source: 0 },
      { start: 7, end: 11, source: 1 },
      { start: 11, end: 16, source: 0 },
    ]);
    expect(segments("", [])).toEqual([]);
  });

  test("의존 트리: 두 번째로 나오면 펼치지 않는다", () => {
    const leafB = { schema: 1 as const, name: "leaf", items: [{ id: "a", text: "x" }] };
    const mid = { schema: 1 as const, name: "mid", items: [{ id: "a", text: "${w:LEAFleaf0001}" }] };
    const dep = { format: 1 as const, root: "midHash00001", lock: { MIDmid000001: "midHash00001", LEAFleaf0001: "leafHash0001" }, docs: { midHash00001: mid, leafHash0001: leafB } };
    const doc = { schema: 1 as const, name: "me", items: [{ id: "a", text: "${w:MIDmid000001} ${w:LEAFleaf0001}" }] };
    const tree = dependencyTree(buildPreviewBundle(doc, [dep]));
    expect(tree.map((n) => [n.name, n.seen, n.children.map((c) => [c.name, c.seen])])).toEqual([
      ["mid", false, [["leaf", false]]],
      ["leaf", true, []],
    ]);
  });
});

describe("임시 보관", () => {
  const memory = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  test("저장·읽기·지우기", () => {
    const s = memory();
    const d = { baseHash: "h", savedAt: "2026-11-03T00:00:00Z", doc: { name: "a", items: [{ id: "x", text: "t" }] }, categories: [4] };
    saveDraft("abc", d, s);
    expect(loadDraft("abc", s)).toEqual(d);
    clearDraft("abc", s);
    expect(loadDraft("abc", s)).toBeNull();
  });

  test("깨진 값이나 막힌 저장소는 없는 것으로", () => {
    const s = memory();
    s.data.set("wakaaka:draft:x", "{not json");
    expect(loadDraft("x", s)).toBeNull();
    s.data.set("wakaaka:draft:y", JSON.stringify({ savedAt: 1 }));
    expect(loadDraft("y", s)).toBeNull();
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDraft("x", throwing)).toBeNull();
    expect(() => saveDraft("x", { baseHash: null, savedAt: "t", doc: { name: "", items: [] }, categories: [] }, throwing)).not.toThrow();
    expect(loadFlag("f", throwing)).toBe(false);
    saveFlag("f", true, s);
    expect(loadFlag("f", s)).toBe(true);
  });
});

describe("속도 제한 문구 (DESIGN 9절)", () => {
  test("Retry-After 초가 있으면 붙이고, 없거나 이상하면 뺀다", async () => {
    const { rateLimitText } = await import("../src/lib/api.ts");
    expect(rateLimitText("20")).toBe("요청이 너무 잦습니다. 20초 뒤에 다시 해 주세요.");
    expect(rateLimitText("0")).toBe("요청이 너무 잦습니다. 1초 뒤에 다시 해 주세요.");
    for (const v of [null, "", "abc", "1e3", "-5", "Wed, 21 Oct 2026 07:28:00 GMT", "9999999"]) {
      expect(rateLimitText(v)).toBe("요청이 너무 잦습니다. 잠시 뒤에 다시 해 주세요.");
    }
  });
});
