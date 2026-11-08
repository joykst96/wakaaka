// 주석 항목 (SPEC 2.7): `#`로 시작하는 행·줄. 편집기 색칠·진단·자동완성·이름 참조·미리보기·텍스트 보기가 같은 규칙을 쓰는지

import { describe, expect, test } from "vitest";
import type { Doc } from "@wakaaka/core";
import { diagnose, openRefBefore, tokenize, type LintContext } from "../src/editor/syntax.ts";
import { tagFragmentBefore, tagInsertText, tagLint, tagPieces, type TagLookup } from "../src/editor/tags.ts";
import { exampleOutputs, GUIDE } from "../src/lib/guide.ts";
import { nameRefs, rewriteItems } from "../src/lib/names.ts";
import { directRefs } from "../src/lib/preview.ts";
import { itemsToText, itemToLine, parseLine, textToItems } from "../src/lib/textview.ts";

const lint: LintContext = { mineIds: new Set(["AAAAAAAAAAAA"]), mineNames: new Map([["hair", "AAAAAAAAAAAA"]]) };
const show = (text: string) => tokenize(text).map((t) => `${t.type}:${text.slice(t.from, t.to)}`);

describe("색칠 토큰", () => {
  test("# 로 시작하면 텍스트 전체가 주석 토큰 하나 (안의 문법·바깥 표기는 칠하지 않음)", () => {
    expect(show("# 메모 {a|${w:AAAAAAAAAAAA}} (x:1.2) BREAK")).toEqual(["comment:# 메모 {a|${w:AAAAAAAAAAAA}} (x:1.2) BREAK"]);
    expect(show("#")).toEqual(["comment:#"]);
  });
  test("맨 앞이 아니면 #는 글자, 맨 앞의 \\#은 이스케이프", () => {
    expect(show(" #a {b}")).toEqual(["brace:{", "brace:}"]);
    expect(show("\\#compass, {a}")).toEqual(["escape:\\#", "brace:{", "brace:}"]);
    expect(show("a\\#b")).toEqual([]);
  });
});

describe("진단", () => {
  test("주석 안의 문법 오류·없는 참조·이름 참조는 진단하지 않는다", () => {
    for (const t of ["# {깨진", "#${w:ZZZZZZZZZZZZ}", "# ${없는 이름}", "#a}"]) expect(diagnose(t, lint), t).toEqual([]);
    // 같은 글자가 주석이 아니면 진단이 나온다
    expect(diagnose(" # {깨진", lint).map((d) => d.severity)).toEqual(["error"]);
  });
  test("태그 표기 lint도 하지 않는다", () => {
    const tags: TagLookup = { get: () => ({ category: 0 }), request: () => {} };
    expect(diagnose("# long_hair", { ...lint, extra: (t) => tagLint(t, tags) })).toEqual([]);
    expect(diagnose("x, long_hair", { ...lint, extra: (t) => tagLint(t, tags) }).length).toBe(1);
    expect(tagPieces("# long_hair, b")).toEqual([]);
  });
});

describe("자동완성", () => {
  test("주석 안에서는 태그·참조 자동완성이 뜨지 않는다", () => {
    expect(tagFragmentBefore("# lon")).toBeNull();
    expect(tagFragmentBefore("#lon")).toBeNull();
    expect(openRefBefore("# ${ha")).toBeNull();
    expect(tagFragmentBefore("x, #lon")).toMatchObject({ query: "#lon" }); // 맨 앞이 아니면 그대로
  });
  test("항목 맨 앞에 #로 시작하는 태그를 넣으면 \\#로 (주석이 되지 않게)", () => {
    expect(tagInsertText("#compass", false, true)).toBe("\\#compass");
    expect(tagInsertText("#compass", false, false)).toBe("#compass");
    expect(tagInsertText("#unicus_(idolmaster)", false, true)).toBe("\\#unicus \\(idolmaster\\)");
    expect(tagFragmentBefore("컴파")).toMatchObject({ from: 0 }); // 맨 앞 자리(cm.ts가 atStart로 넣는다)
  });
});

describe("이름 참조와 미리보기 의존", () => {
  test("주석 안의 ${이름}은 저장할 때 바꾸지 않고, 고를 이름으로 모으지도 않는다", () => {
    const items = [
      { id: "c", text: "# ${hair} 메모" },
      { id: "a", text: "x ${hair}" },
    ];
    expect([...nameRefs(items).keys()]).toEqual(["hair"]);
    expect(nameRefs([items[0]!]).size).toBe(0);
    expect(rewriteItems(items, () => "AAAAAAAAAAAA").map((i) => i.text)).toEqual(["# ${hair} 메모", "x ${w:AAAAAAAAAAAA}"]);
  });
  test("주석 안의 ${w:ID}는 미리보기가 받을 하위 와일드카드가 아니다", () => {
    const d: Doc = { schema: 1, items: [{ id: "c", text: "# ${w:BBBBBBBBBBBB}" }, { id: "a", text: "${w:AAAAAAAAAAAA}" }] };
    expect(directRefs(d)).toEqual(["AAAAAAAAAAAA"]);
  });
});

describe("텍스트 보기", () => {
  test("# 줄은 텍스트가 그대로인 항목, 가중치 표기 뒤도 주석", () => {
    expect(parseLine("# 메모")).toEqual({ text: "# 메모" });
    expect(parseLine("3* # 메모")).toEqual({ text: "# 메모", w: 3 });
    expect(parseLine("\\#compass")).toEqual({ text: "\\#compass" });
    expect(itemToLine({ id: "a", text: "# 메모" })).toBe("# 메모");
    expect(itemToLine({ id: "a", text: "\\#compass", w: 2 })).toBe("2* \\#compass");
  });
  test("주석 줄을 더해도 다른 줄의 항목 ID는 그대로", () => {
    const old = [
      { id: "aaaa", text: "red hair" },
      { id: "bbbb", text: "blue hair" },
    ];
    let k = 0;
    const random = (n: number) => new Uint8Array(n).map((_, i) => (k++ * 7 + i) % 62);
    const r = textToItems(old, "# 머리색\n" + itemsToText(old) + "\n# 끝", random);
    expect(r.items.map((i) => i.text)).toEqual(["# 머리색", "red hair", "blue hair", "# 끝"]);
    expect(r.items.filter((i) => !i.text!.startsWith("#")).map((i) => i.id)).toEqual(["aaaa", "bbbb"]);
  });
});

describe("문법 가이드", () => {
  test("주석 예시: 주석 줄은 결과에 나오지 않고 \\#compass는 #compass", () => {
    const ex = GUIDE.flatMap((s) => s.examples).find((e) => e.code.startsWith("# "))!;
    expect(new Set(exampleOutputs(ex, 5, 80))).toEqual(new Set(["red hair", "#compass"]));
  });
});
