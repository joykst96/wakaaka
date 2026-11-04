// 선택지 보기 가중치 편집 보조: 나열, 고친 텍스트, 입력값, 확률. 고친 텍스트는 파서로 다시 읽어 확인한다.

import { parse, toCommonAst } from "@wakaaka/core";
import { describe, expect, test } from "vitest";
import { choicePercents, listChoices, parseWeightInput, setChoiceWeights } from "../src/lib/choices.ts";
import { choiceHints } from "../src/editor/syntax.ts";

describe("listChoices", () => {
  test("중첩 선택지를 전위 순서로, 보기 원문과 적은 가중치", () => {
    const cs = listChoices("1girl, {3*red|blue|{wavy|2*curly}} hair");
    expect(cs.map((c) => [c.index, c.depth, c.alts.map((a) => [a.raw, a.weight])])).toEqual([
      [0, 1, [["red", 3], ["blue", undefined], ["{wavy|2*curly}", undefined]]],
      [1, 2, [["wavy", undefined], ["curly", 2]]],
    ]);
  });
  test("문법 오류면 빈 목록, 선택지가 없으면 빈 목록", () => {
    expect(listChoices("{a|b")).toEqual([]);
    expect(listChoices("plain")).toEqual([]);
  });
});

describe("setChoiceWeights", () => {
  const roundTrip = (text: string, idx: number, ws: Array<number | undefined>) => {
    const c = listChoices(text)[idx]!;
    return setChoiceWeights(text, c, ws);
  };
  test("가중치를 쓰고, 바꾸고, 지운다", () => {
    expect(roundTrip("{red|blue}", 0, [3, undefined])).toBe("{3*red|blue}");
    expect(roundTrip("{3*red|blue}", 0, [5, 2])).toBe("{5*red|2*blue}");
    expect(roundTrip("{3*red|2*blue}", 0, [undefined, undefined])).toBe("{red|blue}");
  });
  test("중첩된 안쪽 선택지만 바꾸고 바깥은 그대로", () => {
    const t = "x {3*a|{b|c}} y";
    const out = roundTrip(t, 1, [1, 4]);
    expect(out).toBe("x {3*a|{1*b|4*c}} y");
    const p = parse(out, "edit");
    expect(p.ok && toCommonAst(p.nodes)).toEqual(["x ", { choice: [["a"], [{ choice: [["b"], ["c"]], w: [1, 4] }]], w: [3, 1] }, " y"]);
  });
  test("보기 원문이 숫자*로 시작하면 1*을 남긴다(지우면 뜻이 바뀐다)", () => {
    expect(roundTrip("{1*3*x|y}", 0, [undefined, undefined])).toBe("{1*3*x|y}");
  });
  test("빈 보기, 참조, 이스케이프가 있어도 자리가 맞다", () => {
    expect(roundTrip("{|${w:abcdefghijkl}|a\\|b}", 0, [2, 3, 4])).toBe("{2*|3*${w:abcdefghijkl}|4*a\\|b}");
  });
});

describe("입력과 확률", () => {
  test("parseWeightInput", () => {
    expect(parseWeightInput("")).toBeUndefined();
    expect(parseWeightInput(" 3 ")).toBe(3);
    expect(parseWeightInput("0")).toBe(0);
    for (const bad of ["1.5", "-1", "1000001", "abc", "1e3"]) expect(parseWeightInput(bad), bad).toBeNull();
  });
  test("choicePercents: 안 적은 것은 1, 모두 0이면 null", () => {
    expect(choicePercents([3, undefined])).toEqual([75, 25]);
    expect(choicePercents([0, 0])).toBeNull();
  });
});

describe("선택지 안내", () => {
  const hints = (t: string) => {
    const p = parse(t, "edit");
    return p.ok ? choiceHints(t, p.nodes).map((d) => [t.slice(d.from, d.to), d.message]) : [];
  };
  test("Impact Pack식 3::은 3*로 안내, NAI 강조(닫는 ::)는 안내하지 않음", () => {
    expect(hints("{3::red|blue}")).toEqual([["3::", expect.stringContaining("3*")]]);
    expect(hints("{0.5::red|blue}")[0]?.[1]).toContain("0.5*");
    expect(hints("{1.2::artist:wlop ::|blue}")).toEqual([]);
    expect(hints("{3*red|blue}")).toEqual([]);
  });
  test("앞 공백 때문에 가중치가 아닌 보기", () => {
    expect(hints("{ 3*red|blue}")).toEqual([[" 3*", expect.stringContaining("공백")]]);
  });
});
