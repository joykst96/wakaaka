// 태그 표기와 문법 이스케이프 (DESIGN 11절, 2026-11-04 확정). 이스케이프한 텍스트를 파서가 읽으면 원래 글자가 나와야 한다.

import { describe, expect, test } from "vitest";
import { parse, type Node } from "../src/parser.ts";
import { escapeText, promptTag } from "../src/tagtext.ts";

/** 선택지 바깥: 텍스트 노드 하나. 선택지 안: {…} 보기 하나의 텍스트 */
function literalOf(text: string, inChoice: boolean): string | null {
  const p = parse(inChoice ? "{" + text + "}" : text, "edit");
  if (!p.ok) return null;
  let nodes: readonly Node[] = p.nodes;
  if (inChoice) {
    const c = nodes[0];
    if (nodes.length !== 1 || c?.type !== "choice" || c.alts.length !== 1) return null;
    nodes = c.alts[0]!;
  }
  if (nodes.length === 0) return "";
  const t = nodes[0];
  return nodes.length === 1 && t?.type === "text" ? t.value : null;
}

describe("promptTag", () => {
  test.each([
    ["long_hair", "long hair"],
    ["hatsune_miku_(cosplay)", "hatsune miku \\(cosplay\\)"],
    ["^_^", "^_^"],
    ["o_o", "o_o"],
    ["<|>_<|>", "<|>_<|>"],
    ["\\m/", "\\m/"],
    [":d", ":d"],
    ["a_b", "a_b"], // 영숫자 2글자 연속이 없으면 그대로
    // 기호 사이 밑줄도 공백으로 (잠정 규칙은 남겼다. NOTES Phase 5 "표기 규칙 조사")
    ["asuna_(bunny)_(blue_archive)", "asuna \\(bunny\\) \\(blue archive\\)"],
    ["aikatsu!_(series)", "aikatsu! \\(series\\)"],
    ["mr._c.b._(umamusume)", "mr. c.b. \\(umamusume\\)"],
    ["zero(z)_(mega_man)", "zero\\(z\\) \\(mega man\\)"],
    ["100%_orange_juice", "100% orange juice"],
    ["@_@", "@_@"],
    ["<o>_<o>", "<o>_<o>"],
    [">_o", ">_o"],
    ["+_-", "+_-"],
    ["6_9", "6_9"],
    ["t_k_g", "t_k_g"], // 작가 이름도 같은 규칙(분류를 보지 않는다)
    ["m_a_a_m_8", "m_a_a_m_8"],
    ["k-on!", "k-on!"],
  ])("%s → %s", (name, expected) => expect(promptTag(name)).toBe(expected));
});

describe("escapeText 왕복", () => {
  const samples = ["{a|b}", "${x}", "$5", "a\\", "\\{", "\\\\", "\\m/", "\\||/", ":|", "|_|", "double_\\||/", "\\(cosplay\\)", "a|b", "}{", "", "😀 {"];
  test.each(samples.flatMap((s) => [[s, false] as const, [s, true] as const]))("%j inChoice=%s", (s, inChoice) => {
    expect(literalOf(escapeText(s, inChoice), inChoice)).toBe(s);
  });

  test("무작위 문자열 2만 개", () => {
    const alphabet = ["{", "}", "$", "\\", "|", "a", " ", "(", ")", "_"];
    let x = 12345;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31), x);
    for (let i = 0; i < 20000; i++) {
      let s = "";
      for (let n = rnd() % 9; n > 0; n--) s += alphabet[rnd() % alphabet.length];
      for (const inChoice of [false, true]) expect(literalOf(escapeText(s, inChoice), inChoice), JSON.stringify(s)).toBe(s);
    }
  });

  test("이스케이프가 필요 없는 백슬래시는 겹치지 않는다", () => {
    expect(escapeText("\\(a\\)")).toBe("\\(a\\)");
    expect(escapeText("\\||/")).toBe("\\||/");
    expect(escapeText("\\||/", true)).toBe("\\\\\\|\\|/");
  });
});
