// 출처 범위 (SPEC 4.5, TS 전용)와 쉼표 정리의 위치 옮기기.

import { describe, expect, test } from "vitest";
import { cleanup, cleanupWithMap } from "../src/cleanup.ts";
import { expand, type SourceRange } from "../src/expand.ts";
import { loadExpandCases } from "./conformance.ts";

type Docs = Record<string, unknown>;
const bundle = (docs: Docs, lock: Record<string, string> = {}, root = "root00000000") => ({ format: 1, root, lock, docs });

function run(b: unknown, seed: string | bigint = 0n, opts = {}) {
  const r = expand(b, seed, opts);
  if (!r.ok) throw new Error(r.error.code);
  return r;
}

const pick = (s: SourceRange) => [s.start, s.end, s.wildcard, s.item] as const;

describe("출처 범위", () => {
  test("인라인 참조: 하위 항목 범위가 바깥 항목 범위 안에 있고 바깥이 먼저다", () => {
    const b = bundle(
      {
        root00000000: { schema: 1, items: [{ id: "i001", text: "a ${w:Wred00000000} b" }] },
        redDoc000001: { schema: 1, items: [{ id: "c001", text: "red" }] },
      },
      { Wred00000000: "redDoc000001" },
    );
    const r = run(b);
    expect(r.text).toBe("a red b");
    expect(r.sources).toEqual([
      { start: 0, end: 7, hash: "root00000000", wildcard: null, item: "i001" },
      { start: 2, end: 5, hash: "redDoc000001", wildcard: "Wred00000000", item: "c001" },
    ]);
    expect(run(b, 0n, { rootWildcard: "Wroot0000000" }).sources[0]!.wildcard).toBe("Wroot0000000");
  });

  test("쉼표 정리로 지워진 만큼 옮긴다", () => {
    // 0개를 뽑는 참조 뒤의 ", "가 지워진다: 정리 전 ", red" → "red"
    const b = bundle(
      {
        root00000000: { schema: 1, items: [{ id: "i001", text: "${w:Wnone0000000}, ${w:Wred00000000}" }] },
        noneDoc00001: { schema: 1, select: { count: [0, 0] }, items: [{ id: "n001", text: "never" }] },
        redDoc000001: { schema: 1, items: [{ id: "c001", text: "red" }] },
      },
      { Wnone0000000: "noneDoc00001", Wred00000000: "redDoc000001" },
    );
    const r = run(b);
    expect(r.text).toBe("red");
    expect(r.sources.map(pick)).toEqual([
      [0, 3, null, "i001"],
      [0, 3, "Wred00000000", "c001"],
    ]);
  });

  test("조각 가운데의 빈 조각과 앞뒤 공백", () => {
    const r = run(bundle({ root00000000: { schema: 1, items: [{ id: "i001", text: "  a, , b  " }] } }));
    expect(r.text).toBe("a, b");
    expect(r.sources.map(pick)).toEqual([[0, 4, null, "i001"]]);
  });

  test("구분자는 범위에 들지 않고, 빈 결과는 범위를 남기지 않는다", () => {
    const b = bundle({
      root00000000: {
        schema: 1,
        select: { count: [3, 3], sep: " | " },
        items: [
          { id: "a", text: "x" },
          { id: "b", text: "yy" },
          { id: "c", text: "" },
        ],
      },
    });
    for (let seed = 0n; seed < 20n; seed++) {
      const r = run(b, seed);
      expect(r.sources).toHaveLength(2);
      const parts = r.sources.map((s) => r.text.slice(s.start, s.end));
      expect(parts.slice().sort()).toEqual(["x", "yy"]);
      expect(r.text).toBe(parts.join(" | "));
    }
  });

  test("spread로 펼친 항목은 대상 문서의 범위다", () => {
    const b = bundle(
      {
        root00000000: { schema: 1, select: { count: [2, 2] }, items: [{ id: "sp01", ref: { wildcard: "Wcolor000000" }, spread: true }] },
        colorDoc0001: { schema: 1, items: [{ id: "c001", text: "red" }, { id: "c002", text: "blue" }] },
      },
      { Wcolor000000: "colorDoc0001" },
    );
    const r = run(b);
    expect(r.sources).toHaveLength(2);
    for (const s of r.sources) {
      expect(s.hash).toBe("colorDoc0001");
      expect(s.wildcard).toBe("Wcolor000000");
      expect(r.text.slice(s.start, s.end)).toBe(s.item === "c001" ? "red" : "blue");
    }
  });

  test("ref 항목: 바깥 항목 범위와 대상 항목 범위가 같은 자리다", () => {
    const b = bundle(
      {
        root00000000: { schema: 1, items: [{ id: "r001", ref: { wildcard: "Wred00000000" } }] },
        redDoc000001: { schema: 1, items: [{ id: "c001", text: "{red|crimson}" }] },
      },
      { Wred00000000: "redDoc000001" },
    );
    const r = run(b);
    expect(r.sources).toEqual([
      { start: 0, end: r.text.length, hash: "root00000000", wildcard: null, item: "r001" },
      { start: 0, end: r.text.length, hash: "redDoc000001", wildcard: "Wred00000000", item: "c001" },
    ]);
  });

  test("UTF-16 오프셋", () => {
    const b = bundle(
      {
        root00000000: { schema: 1, items: [{ id: "i001", text: "😀 ${w:Wred00000000}" }] },
        redDoc000001: { schema: 1, items: [{ id: "c001", text: "빨강" }] },
      },
      { Wred00000000: "redDoc000001" },
    );
    const r = run(b);
    expect(r.text).toBe("😀 빨강");
    expect(r.sources.map(pick)).toEqual([
      [0, 5, null, "i001"],
      [3, 5, "Wred00000000", "c001"],
    ]);
  });

  // 공통 테스트 세트의 모든 성공 실행에서 범위의 일반 성질을 본다.
  const cases = loadExpandCases();
  test("모든 공통 사례: 범위가 문자열 안에 있고, 서로 겹치면 포함 관계이며, 전위 순서다", () => {
    let checked = 0;
    for (const c of cases) {
      for (const runCase of c.runs) {
        if (runCase.text === undefined) continue;
        const r = expand(c.bundle, runCase.seed, { limits: c.limits ?? {} });
        if (!r.ok) throw new Error(c.file);
        const ss = r.sources;
        for (const s of ss) expect(0 <= s.start && s.start < s.end && s.end <= r.text.length).toBe(true);
        for (let i = 0; i < ss.length; i++) {
          for (let j = i + 1; j < ss.length; j++) {
            const a = ss[i]!;
            const b = ss[j]!;
            const disjoint = a.end <= b.start || b.end <= a.start;
            const aHasB = a.start <= b.start && b.end <= a.end;
            expect(disjoint || aHasB, `${c.file} ${runCase.seed} ${i} ${j}`).toBe(true);
            if (!aHasB) expect(a.end <= b.start, `${c.file} order`).toBe(true);
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("쉼표 정리의 위치 지도", () => {
  test("길이 6까지의 모든 문자열: 명세 그대로의 cleanup과 같고, 지도가 남은 글자를 가리킨다", () => {
    const alphabet = [",", " ", "\t", "a", " "];
    let n = 0;
    const visit = (s: string) => {
      const r = cleanupWithMap(s);
      expect(r.text).toBe(cleanup(s));
      expect(r.map(0)).toBe(0);
      expect(r.map(s.length)).toBe(r.text.length);
      for (let i = 0; i < s.length; i++) {
        const d = r.map(i + 1) - r.map(i);
        expect(d === 0 || d === 1).toBe(true);
        if (d === 1) expect(r.text[r.map(i)]).toBe(s[i]);
      }
      n++;
    };
    const gen = (prefix: string, left: number) => {
      visit(prefix);
      if (left > 0) for (const ch of alphabet) gen(prefix + ch, left - 1);
    };
    gen("", 6);
    expect(n).toBe((5 ** 7 - 1) / 4);
  });
});
