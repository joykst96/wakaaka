// 태그 자동완성 자리, 넣는 표기, 표기 lint (DESIGN 11절). editor/tags.ts는 DOM·네트워크 없는 순수 함수다.

import { describe, expect, it, test } from "vitest";
import { diagnose } from "../src/editor/syntax.ts";
import { formatPostCount, lintCandidate, tagDisplayName, tagFragmentBefore, tagInsertText, tagLint, tagPieces, type TagLookup } from "../src/editor/tags.ts";

describe("tagFragmentBefore: 자동완성이 뜨는 자리", () => {
  test.each([
    ["lon", { from: 0, query: "lon", inChoice: false }],
    ["1girl, lon", { from: 7, query: "lon", inChoice: false }],
    ["1girl,lon", { from: 6, query: "lon", inChoice: false }],
    ["1girl,  long h", { from: 8, query: "long h", inChoice: false }],
    ["{red|lo", { from: 5, query: "lo", inChoice: true }],
    ["{lo", { from: 1, query: "lo", inChoice: true }],
    ["{3*lo", { from: 3, query: "lo", inChoice: true }],
    ["{a|{b|c}|lo", { from: 9, query: "lo", inChoice: true }],
    ["{a|b}, lo", { from: 7, query: "lo", inChoice: false }],
    ["a, (long", { from: 4, query: "long", inChoice: false }],
    ["a, ((long", { from: 5, query: "long", inChoice: false }],
    ["1girl, 긴머", { from: 7, query: "긴머", inChoice: false }],
    ["${w:AAAAAAAAAAAA}, lo", { from: 19, query: "lo", inChoice: false }],
    ["<lora:x,y:0.8>, lo", { from: 16, query: "lo", inChoice: false }],
  ])("%j → %j", (before, expected) => expect(tagFragmentBefore(before)).toEqual(expected));

  test.each([
    [""],
    ["1girl, "],
    ["a, "],
    ["${hair"], // 열린 참조는 `${` 자동완성
    ["{a|b} hai"], // 선택지 뒤에 붙인 글자는 태그 자리가 아니다
    ["a, \\{x"], // 이스케이프
    ["a, x\\"],
    ["a, $x"],
    ["<lora:x,y> lo"], // 바깥 표기 안의 쉼표는 경계가 아니다
    ["a, " + "x".repeat(65)],
  ])("%j → 자리 아님", (before) => expect(tagFragmentBefore(before)).toBeNull());
});

describe("넣는 표기 (core tagtext 확정 규칙)", () => {
  it("밑줄 → 공백, 괄호 이스케이프, 이모티콘은 그대로, 선택지 안이면 | 이스케이프", () => {
    expect(tagInsertText("long_hair", false)).toBe("long hair");
    expect(tagInsertText("hatsune_miku_(cosplay)", false)).toBe("hatsune miku \\(cosplay\\)");
    expect(tagInsertText("asuna_(bunny)_(blue_archive)", true)).toBe("asuna \\(bunny\\) \\(blue archive\\)");
    expect(tagInsertText("^_^", false)).toBe("^_^");
    expect(tagInsertText(":|", false)).toBe(":|");
    expect(tagInsertText(":|", true)).toBe(":\\|");
    expect(tagInsertText("\\m/", false)).toBe("\\m/");
  });
  it("목록 표시는 괄호 이스케이프 없이", () => {
    expect(tagDisplayName("hatsune_miku_(cosplay)")).toBe("hatsune miku (cosplay)");
    expect(tagDisplayName("^_^")).toBe("^_^");
  });
  test.each([
    [50, "50"],
    [999, "999"],
    [1000, "1K"],
    [1300, "1.3K"],
    [131891, "132K"],
    [5589043, "5.6M"],
    [7_000_000, "7M"],
  ])("포스트 수 %d → %s", (n, s) => expect(formatPostCount(n)).toBe(s));
});

describe("tagPieces: 표기 lint가 보는 조각", () => {
  it("쉼표·선택지·참조·ComfyUI 강조가 경계, 앞뒤 공백 제외, 선택지 안 표시", () => {
    const text = "1girl, long_hair ,{a_b|c (d)}, ${w:AAAAAAAAAAAA}x_y, (p_q:1.2)";
    expect(tagPieces(text).map((p) => [p.text, p.inChoice, text.slice(p.from, p.to)])).toEqual([
      ["1girl", false, "1girl"],
      ["long_hair", false, "long_hair"],
      ["a_b", true, "a_b"],
      ["c (d)", true, "c (d)"],
      ["x_y", false, "x_y"],
      ["p_q", false, "p_q"],
    ]);
  });
  it("토큰 안의 쉼표는 경계가 아니다", () => {
    expect(tagPieces("<lora:a,b:1>, x").map((p) => p.text)).toEqual(["x"]);
  });
  it("lint 후보는 밑줄이나 이스케이프 안 된 괄호가 있을 때만", () => {
    expect(lintCandidate("long_hair")).toBe("long_hair");
    expect(lintCandidate("Long_Hair")).toBe("long_hair");
    expect(lintCandidate("hatsune miku (cosplay)")).toBe("hatsune_miku_(cosplay)");
    expect(lintCandidate("hatsune miku \\(cosplay\\)")).toBeNull();
    expect(lintCandidate("long hair")).toBeNull();
  });
});

function lookup(known: Record<string, number>): TagLookup & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get: (n) => (n in known ? { category: known[n]! } : n.startsWith("pending") ? undefined : null),
    request: (names) => asked.push(...names),
  };
}

describe("tagLint", () => {
  const tags = lookup({ long_hair: 0, "hatsune_miku_(cosplay)": 4, "^_^": 0, ":|": 0, "a_b": 0 });

  it("밑줄 표기와 이스케이프 안 된 괄호, 고칠 표기", () => {
    const text = "1girl, long_hair, hatsune miku (cosplay), ^_^, Long_Hair, (masterpiece), hatsune miku \\(cosplay\\)";
    const d = tagLint(text, tags);
    expect(d.map((x) => [text.slice(x.from, x.to), x.fix.insert, x.severity])).toEqual([
      ["long_hair", "long hair", "info"],
      ["hatsune miku (cosplay)", "hatsune miku \\(cosplay\\)", "info"],
      ["Long_Hair", "long hair", "info"],
    ]);
    expect(d[0]!.message).toBe("밑줄 표기입니다. 고치면: long hair");
    expect(d[1]!.message).toBe("괄호가 ComfyUI 가중치로 읽힙니다. 고치면: hatsune miku \\(cosplay\\)");
  });

  it("선택지 안은 선택지 이스케이프로, ComfyUI 강조 안쪽도 본다", () => {
    expect(tagLint("{long_hair|x}", tags).map((x) => x.fix.insert)).toEqual(["long hair"]);
    expect(tagLint("(long_hair:1.2)", tags).map((x) => [x.from, x.to, x.fix.insert])).toEqual([[1, 10, "long hair"]]);
  });

  it("이모티콘처럼 밑줄을 남기는 태그는 안내하지 않는다", () => {
    expect(tagLint("^_^, {^_^|x}", tags)).toEqual([]);
    expect(tagLint("a_b", tags)).toEqual([]);
  });

  it("모르는 이름은 묻고 아직 안내하지 않는다", () => {
    const t = lookup({});
    expect(tagLint("pending_one, plain, pending_(two)", t)).toEqual([]);
    expect(t.asked).toEqual(["pending_one", "pending_(two)"]);
  });

  it("diagnose의 extra로 붙고, 문법 오류가 있으면 돌지 않는다", () => {
    const ctx = { mineIds: new Set<string>(), mineNames: new Map<string, string>(), extra: (s: string) => tagLint(s, tags) };
    expect(diagnose("long_hair, {a|b}", ctx).map((d) => d.fix?.insert)).toEqual(["long hair"]);
    expect(diagnose("long_hair, {a|b", ctx).map((d) => d.severity)).toEqual(["error"]);
    // 남의 와일드카드 보기(mineIds null)에서는 검사하지 않는다
    expect(diagnose("long_hair", { mineIds: null, mineNames: null, extra: ctx.extra })).toEqual([]);
  });
});
