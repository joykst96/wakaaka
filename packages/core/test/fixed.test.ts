// 고정 표시 (DESIGN 3절 "고정 표시"). 판정 표와, 고정이라고 본 문서는 seed를 바꿔도 전개 결과가 같은지 확인한다.

import { describe, expect, test } from "vitest";
import { expand } from "../src/expand.ts";
import { isFixedDoc } from "../src/fixed.ts";

const W = "abcdefghijkl";
type Items = Array<Record<string, unknown>>;
const doc = (items: Items, count?: [number, number]) => ({ schema: 1, items, ...(count ? { select: { count, sep: ", " } } : {}) });

describe("판정", () => {
  const cases: Array<[string, ReturnType<typeof doc>, boolean]> = [
    ["글자 한 줄", doc([{ id: "a", text: "hatsune miku, aqua hair, twintails" }]), true],
    ["개수 1~1을 적음", doc([{ id: "a", text: "x" }], [1, 1]), true],
    ["개수 1~3이어도 후보가 하나", doc([{ id: "a", text: "x" }], [1, 3]), true],
    ["가중치를 적음", doc([{ id: "a", text: "x", w: 5 }]), true],
    ["이스케이프한 중괄호는 글자", doc([{ id: "a", text: "\\{not a choice\\}" }]), true],
    ["ComfyUI 괄호와 백슬래시", doc([{ id: "a", text: "(masterpiece:1.2), \\(cat\\)" }]), true],
    ["주석 항목은 세지 않는다", doc([{ id: "a", text: "# 메모" }, { id: "b", text: "x" }, { id: "c", text: "#{a|b}" }]), true],
    ["맨 앞 \\#은 글자", doc([{ id: "a", text: "\\#compass" }]), true],
    ["항목 두 개", doc([{ id: "a", text: "x" }, { id: "b", text: "y" }]), false],
    ["선택지", doc([{ id: "a", text: "x, {smile|grin}" }]), false],
    ["보기 하나짜리 선택지도 선택지", doc([{ id: "a", text: "{x}" }]), false],
    ["인라인 참조", doc([{ id: "a", text: "x, ${w:" + W + "}" }]), false],
    ["ref 항목", doc([{ id: "a", ref: { wildcard: W } }]), false],
    ["개수 0~1", doc([{ id: "a", text: "x" }], [0, 1]), false],
    ["가중치 0", doc([{ id: "a", text: "x", w: 0 }]), false],
    ["빈 와일드카드", doc([]), false],
    ["주석뿐", doc([{ id: "a", text: "# x" }]), false],
    ["빈 텍스트", doc([{ id: "a", text: "" }]), false],
    ["공백뿐", doc([{ id: "a", text: "   " }]), false],
    ["문법 오류", doc([{ id: "a", text: "x {a|b" }]), false],
  ];
  test.each(cases)("%s", (_name, d, want) => {
    expect(isFixedDoc(d as never)).toBe(want);
  });

  test("편집 모드: 이름 참조도 참조", () => {
    expect(isFixedDoc(doc([{ id: "a", text: "x, ${미쿠 의상}" }]) as never, "edit")).toBe(false);
    // 저장 모드에서는 이름 참조가 문법 오류라 역시 고정이 아니다
    expect(isFixedDoc(doc([{ id: "a", text: "x, ${미쿠 의상}" }]) as never)).toBe(false);
    expect(isFixedDoc(doc([{ id: "a", text: "red hair" }]) as never, "edit")).toBe(true);
  });
});

describe("고정이면 seed와 상관없이 전개 결과가 같다", () => {
  const out = (d: object, seed: string) => {
    const r = expand({ format: 1, root: "root00000000", lock: {}, docs: { root00000000: d } }, seed);
    if (!r.ok) throw new Error(r.error.code);
    return r.text;
  };
  const seeds = ["0", "1", "42", "18446744073709551615", "1234567890123"];
  const fixedDocs = [
    doc([{ id: "a", text: "hatsune miku, aqua hair" }]),
    doc([{ id: "a", text: "x" }], [1, 3]),
    doc([{ id: "z", text: "# c" }, { id: "a", text: "1girl, , solo" }, { id: "q", text: "#{a|b}" }]),
    doc([{ id: "a", text: "\\{lit\\}, \\$x" }]),
  ];
  test.each(fixedDocs.map((d, i) => [i, d] as const))("문서 %i", (_i, d) => {
    expect(isFixedDoc(d as never)).toBe(true);
    const first = out(d, seeds[0]!);
    for (const s of seeds) expect(out(d, s)).toBe(first);
  });
  test("대조: 고정이 아닌 문서는 seed에 따라 달라질 수 있다", () => {
    const d = doc([{ id: "a", text: "{a|b|c|d|e|f|g|h}" }]);
    expect(isFixedDoc(d as never)).toBe(false);
    expect(new Set(seeds.map((s) => out(d, s))).size).toBeGreaterThan(1);
  });
});
