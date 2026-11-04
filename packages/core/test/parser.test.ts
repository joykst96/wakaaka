// 파서 단위 테스트: 오류 위치와 노드 위치(UTF-16 오프셋), 노드 번호. 공통 테스트 세트는 위치를 비교하지 않는다.

import { describe, expect, test } from "vitest";
import { parse, type Node, type ParseMode } from "../src/parser.ts";

function err(text: string, mode: ParseMode = "stored") {
  const r = parse(text, mode);
  if (r.ok) throw new Error(`expected error: ${JSON.stringify(text)}`);
  return r.error;
}

function nodes(text: string, mode: ParseMode = "stored"): Node[] {
  const r = parse(text, mode);
  if (!r.ok) throw new Error(`unexpected ${r.error.code}`);
  return r.nodes;
}

describe("오류 위치", () => {
  test.each([
    // [텍스트, 코드, start, end]
    ["{a", "E_UNCLOSED_CHOICE", 0, 1],
    ["{a|{b}", "E_UNCLOSED_CHOICE", 0, 1],
    ["x {a {b", "E_UNCLOSED_CHOICE", 5, 6], // 가장 안쪽의 닫히지 않은 {
    ["a}", "E_UNMATCHED_CLOSE", 1, 2],
    ["{a}}", "E_UNMATCHED_CLOSE", 3, 4],
    ["a} {b", "E_UNMATCHED_CLOSE", 1, 2], // 처음 만난 오류
    ["ab ${w:abc", "E_UNCLOSED_REF", 3, 10], // ${부터 끝까지
    ["x${}y", "E_REF_EMPTY", 1, 4], // 참조 전체
    ["${ \t }", "E_REF_EMPTY", 0, 6],
    ["${a{b}c}", "E_REF_INVALID", 0, 6], // 본문은 첫 }까지
    ["${w:short}", "E_REF_INVALID", 0, 10],
    ["${h:Snap00000001}", "E_REF_RESERVED", 0, 17],
    ["{a|${x=1}}", "E_REF_RESERVED", 3, 9],
    ["{a ${} ", "E_REF_EMPTY", 3, 6], // 끝의 닫히지 않은 {보다 먼저 만난다
    ["{".repeat(65), "E_NESTING", 64, 65],
  ] as const)("%j → %s [%i, %i)", (text, code, start, end) => {
    expect(err(text)).toEqual({ code, start, end });
  });

  test("UTF-16 오프셋: 코드 포인트 오프셋과 다르다", () => {
    // 😀는 UTF-16 두 단위, 코드 포인트 하나. 한글은 둘 다 하나.
    expect(err("😀{a")).toEqual({ code: "E_UNCLOSED_CHOICE", start: 2, end: 3 });
    expect(err("😀${hair color}")).toEqual({ code: "E_REF_NAME", start: 2, end: 15 });
    expect(err("한글 ${a|b}")).toEqual({ code: "E_REF_INVALID", start: 3, end: 9 });
    expect(err("𝒳𝒴 a}")).toEqual({ code: "E_UNMATCHED_CLOSE", start: 6, end: 7 });
  });

  test("편집 형태는 이름 참조를 받고 저장 형태는 E_REF_NAME", () => {
    expect(err("a ${hair color}", "stored")).toEqual({ code: "E_REF_NAME", start: 2, end: 15 });
    expect(nodes("a ${ hair color }", "edit")[1]).toEqual({ type: "ref", kind: "name", name: "hair color", n: 0, start: 2, end: 17 });
  });

  test("오류 위치는 텍스트 범위 안이다", () => {
    for (const t of ["{", "}", "${", "${}", "{{{", "a{b|c", "${a=b}", "x${w:hairColor001"]) {
      const e = err(t);
      expect(0 <= e.start && e.start < e.end && e.end <= t.length).toBe(true);
    }
  });
});

describe("노드 위치와 번호", () => {
  test("글자, 참조, 선택지의 범위", () => {
    expect(nodes("x ${w:hairColor001} {a|b}")).toEqual([
      { type: "text", value: "x ", start: 0, end: 2 },
      { type: "ref", kind: "w", id: "hairColor001", n: 0, start: 2, end: 19 },
      { type: "text", value: " ", start: 19, end: 20 },
      {
        type: "choice",
        n: 1,
        start: 20,
        end: 25,
        alts: [[{ type: "text", value: "a", start: 21, end: 22 }], [{ type: "text", value: "b", start: 23, end: 24 }]],
        weights: [1, 1],
        weighted: false,
        altStarts: [21, 23],
        weightEnds: [21, 23],
      },
    ]);
  });

  test("보기 가중치의 위치와 오류 위치 (SPEC 2.2 규칙 0)", () => {
    const [c] = nodes("{3*ab|cd|007*}") as [Extract<Node, { type: "choice" }>];
    expect(c.weights).toEqual([3, 1, 7]);
    expect(c.weighted).toBe(true);
    expect(c.altStarts).toEqual([1, 6, 9]);
    expect(c.weightEnds).toEqual([3, 6, 13]);
    expect(c.alts[0]).toEqual([{ type: "text", value: "ab", start: 3, end: 5 }]);
    const err = (t: string) => {
      const r = parse(t, "edit");
      return r.ok ? null : r.error;
    };
    // 가중치 표기 범위
    expect(err("ab {1.5*x}")).toEqual({ code: "E_CHOICE_WEIGHT", start: 4, end: 8 });
    expect(err("{x|99999999*y}")).toEqual({ code: "E_CHOICE_WEIGHT", start: 3, end: 12 });
    // 모두 0이면 여는 괄호
    expect(err("a {0*x|0*y}")).toEqual({ code: "E_CHOICE_WEIGHT", start: 2, end: 3 });
    // 아주 긴 숫자(앞의 0)와 아주 큰 수
    expect(parse("{" + "0".repeat(40) + "5*x}", "edit").ok).toBe(true);
    expect(err("{" + "9".repeat(400) + "*x}")?.code).toBe("E_CHOICE_WEIGHT");
  });

  test("이스케이프는 원문 범위를 덮는다", () => {
    expect(nodes("\\{a\\}")).toEqual([{ type: "text", value: "{a}", start: 0, end: 5 }]);
    expect(nodes("😀\\$")).toEqual([{ type: "text", value: "😀$", start: 0, end: 4 }]);
  });

  test("번호는 전위 순회, 뽑히지 않을 보기 안도 센다", () => {
    const ns = nodes("{a|{b|${w:AAAAAAAAAAAA}}}${w:BBBBBBBBBBBB}{c}");
    const numbers: Array<[string, number]> = [];
    const walk = (list: Node[]) => {
      for (const nd of list) {
        if (nd.type === "ref") numbers.push([nd.kind === "w" ? nd.id : nd.name, nd.n]);
        if (nd.type === "choice") {
          numbers.push(["choice@" + nd.start, nd.n]);
          nd.alts.forEach(walk);
        }
      }
    };
    walk(ns);
    expect(numbers).toEqual([
      ["choice@0", 0],
      ["choice@3", 1],
      ["AAAAAAAAAAAA", 2],
      ["BBBBBBBBBBBB", 3],
      ["choice@42", 4],
    ]);
    const r = parse("{a|{b|${w:AAAAAAAAAAAA}}}${w:BBBBBBBBBBBB}{c}");
    expect(r.ok && r.nodeCount).toBe(5);
  });

  test("64겹은 허용하고 위치가 맞다", () => {
    const t = "{".repeat(64) + "x" + "}".repeat(64);
    let nd = nodes(t)[0]!;
    for (let depth = 0; depth < 63; depth++) {
      expect(nd).toMatchObject({ type: "choice", n: depth, start: depth, end: t.length - depth });
      nd = (nd as Extract<Node, { type: "choice" }>).alts[0]![0]!;
    }
    expect(nd).toMatchObject({ type: "choice", n: 63, start: 63, end: 66 });
  });
});
