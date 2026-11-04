// 텍스트 보기: 줄 형식 왕복과 항목 ID 유지 (DESIGN 11절)

import { describe, expect, test } from "vitest";
import type { EditItem } from "../src/lib/editdoc.ts";
import { canUseTextView, itemsToText, itemToLine, matchLines, parseLine, textToItems } from "../src/lib/textview.ts";

let counter = 0;
// 새 ID를 알아보기 쉽게: n0, n1 … (base62 글자만)
const fakeRandom = (n: number) => {
  const s = ("n" + counter++).padEnd(n, "0").slice(0, n);
  return new Uint8Array([...s].map((c) => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".indexOf(c)));
};
const ids = (items: EditItem[]) => items.map((i) => i.id);

describe("줄 형식", () => {
  test.each<[EditItem, string]>([
    [{ id: "a", text: "red hair" }, "red hair"],
    [{ id: "a", text: "red hair", w: 3 }, "3* red hair"],
    [{ id: "a", text: "red hair", w: 1 }, "1* red hair"],
    [{ id: "a", text: "" }, "*"],
    [{ id: "a", text: "", w: 2 }, "2* "],
    [{ id: "a", text: " x", w: 2 }, "2*  x"],
    [{ id: "a", text: "5*literal" }, "* 5*literal"],
    [{ id: "a", text: "*" }, "* *"],
    [{ id: "a", text: "* x" }, "* * x"],
    [{ id: "a", text: "*sparkle*" }, "*sparkle*"],
    [{ id: "a", text: "2::red hair::" }, "2::red hair::"],
    [{ id: "a", text: "{3*a|b}" }, "{3*a|b}"],
    [{ id: "a", text: " lead" }, " lead"],
    [{ id: "a", ref: "abcdefghijkl" }, "${w:abcdefghijkl}"],
    [{ id: "a", ref: "abcdefghijkl", w: 4 }, "4* ${w:abcdefghijkl}"],
    [{ id: "a", ref: "abcdefghijkl", spread: true }, "${w:abcdefghijkl}"],
  ])("%j ↔ %j", (item, line) => {
    expect(itemToLine(item)).toBe(line);
    const p = parseLine(line);
    const text = item.ref !== undefined ? "${w:" + item.ref + "}" : item.text;
    expect(p.text).toBe(text);
    expect(p.w).toBe(item.ref !== undefined && item.spread ? undefined : item.w);
  });

  test("가중치 범위, 새로 친 NAI 강조 줄은 글자", () => {
    expect(parseLine("1000000* x").badWeight).toBeUndefined();
    expect(parseLine("1000001* x").badWeight).toBe(true);
    expect(parseLine("007* x")).toEqual({ text: "x", w: 7 });
    expect(parseLine("3*x")).toEqual({ text: "x", w: 3 });
    // 예전 형식과 NAI 강조는 이제 글자다
    expect(parseLine("2::red hair::")).toEqual({ text: "2::red hair::" });
    expect(parseLine("3:: red hair")).toEqual({ text: "3:: red hair" });
    expect(parseLine("1.5* x")).toEqual({ text: "1.5* x" });
  });

  test("줄바꿈이 든 항목이 있으면 텍스트 보기를 쓸 수 없다", () => {
    expect(canUseTextView([{ id: "a", text: "x" }, { id: "b", ref: "abcdefghijkl" }])).toBe(true);
    expect(canUseTextView([{ id: "a", text: "x\ny" }])).toBe(false);
    expect(canUseTextView([{ id: "a", text: "x\ry" }])).toBe(false);
  });
});

describe("항목 ID 유지", () => {
  const base: EditItem[] = [
    { id: "A", text: "red", w: 3 },
    { id: "B", text: "blue" },
    { id: "C", ref: "abcdefghijkl", spread: true },
    { id: "D", text: "green" },
  ];

  test("아무것도 안 고치면 모든 항목이 그대로", () => {
    const r = textToItems(base, itemsToText(base), fakeRandom);
    expect(r.items).toEqual(base);
  });

  test("바뀌지 않은 줄은 기존 ID, 같은 위치에서 고친 줄도 기존 ID, 새 줄만 새 ID", () => {
    counter = 0;
    const text = ["3* red", "navy", "${w:abcdefghijkl}", "new line", "green"].join("\n");
    const r = textToItems(base, text, fakeRandom);
    expect(ids(r.items)).toEqual(["A", "B", "C", "n000", "D"]);
    expect(r.items[1]).toEqual({ id: "B", text: "navy" });
    expect(r.items[2]).toEqual({ id: "C", ref: "abcdefghijkl", spread: true });
  });

  test("줄 순서를 바꿔도 내용이 같은 줄은 ID를 따라간다", () => {
    counter = 0;
    const r = textToItems(base, ["green", "3* red", "blue"].join("\n"), fakeRandom);
    // LCS: [3* red, blue]가 남고 green은 앞쪽 구간에 끼어 위치로 짝지을 옛 줄이 없다 → 새 ID
    expect(ids(r.items)).toEqual(["n000", "A", "B"]);
  });

  test("줄을 지우면 그 항목만 빠진다", () => {
    const r = textToItems(base, ["3* red", "green"].join("\n"), fakeRandom);
    expect(ids(r.items)).toEqual(["A", "D"]);
  });

  test("빈 줄은 항목이 아니다, *는 빈 항목", () => {
    counter = 0;
    const r = textToItems([], "a\n\n*\n\nb\n", fakeRandom);
    expect(r.items.map((i) => i.text)).toEqual(["a", "", "b"]);
  });

  test("가중치를 고치면 같은 ID에 새 가중치, 펼침 줄에 가중치를 붙이면 펼침이 풀린다", () => {
    const r = textToItems(base, ["5* red", "blue", "2* ${w:abcdefghijkl}", "green"].join("\n"), fakeRandom);
    expect(r.items[0]).toEqual({ id: "A", text: "red", w: 5 });
    expect(r.items[2]).toEqual({ id: "C", ref: "abcdefghijkl", w: 2 });
  });

  test("새로 쓴 ${w:} 줄은 텍스트 항목 (ref 항목과 결과가 같다, SPEC 4.3)", () => {
    counter = 0;
    const r = textToItems([], "${w:abcdefghijkl}", fakeRandom);
    expect(r.items).toEqual([{ id: "n000", text: "${w:abcdefghijkl}" }]);
  });

  test("새 ID는 기존 ID와 겹치지 않는다", () => {
    const old: EditItem[] = [{ id: "n000", text: "x" }];
    counter = 0;
    const r = textToItems(old, "x\ny", fakeRandom);
    expect(new Set(ids(r.items)).size).toBe(2);
    expect(r.items[0]!.id).toBe("n000");
  });

  test("범위를 벗어난 가중치는 표시한다", () => {
    expect(textToItems([], "a\n2000000* b", fakeRandom).badWeights).toEqual([1]);
  });
});

describe("matchLines", () => {
  test("같은 줄이 여러 번 나와도 LCS로", () => {
    // 앞 x, 뒤 b는 공통 부분. 가운데 [a, x]와 [x]에서 x끼리 짝, a는 지운 줄
    const m = matchLines(["x", "a", "x", "b"], ["x", "x", "b"]);
    expect([...m].sort((p, q) => p[0] - q[0])).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  test("큰 입력은 위치로만 짝짓는다(시간 제한)", () => {
    const a = Array.from({ length: 3000 }, (_, i) => "a" + i);
    const b = Array.from({ length: 3000 }, (_, i) => "b" + i);
    const t = performance.now();
    const m = matchLines(a, b);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(m.size).toBe(3000);
    expect(m.get(17)).toBe(17);
  });

  test("5,000줄에서 한 줄만 고치면 나머지는 모두 짝", () => {
    const a = Array.from({ length: 5000 }, (_, i) => "t" + i);
    const b = [...a];
    b[2500] = "changed";
    b.splice(100, 0, "inserted");
    const m = matchLines(a, b);
    expect(m.size).toBe(5000);
    expect(m.get(2500)).toBe(2501);
    expect(m.get(99)).toBe(99);
    expect(m.get(100)).toBe(101);
  });
});
