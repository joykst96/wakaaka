// 편집기 색칠 토큰: 선택지 겹 수, 바깥 프롬프트 표기(ComfyUI·LoRA·NAI·BREAK)

import { describe, expect, test } from "vitest";
import { openRefBefore, tokenize } from "../src/editor/syntax.ts";

const show = (text: string) =>
  tokenize(text).map((t) => {
    const s = text.slice(t.from, t.to);
    if (t.type === "brace" || t.type === "bar") return `${s}${t.depth}`;
    if (t.type === "foreign") return `${t.kind}:${s}`;
    return `${t.type}:${s}`;
  });

describe("선택지 겹 수", () => {
  test("짝이 맞는 괄호는 같은 겹 수, 세로선은 자기 선택지의 겹 수", () => {
    expect(show("{a|{b|c}|d}")).toEqual(["{1", "|1", "{2", "|2", "}2", "|1", "}1"]);
  });
  test("짝 없는 }는 1, 이스케이프는 선택지 기호가 아님", () => {
    expect(show("a} \\{x\\}")).toEqual(["}1", "escape:\\{", "escape:\\}"]);
  });
});

describe("보기 가중치", () => {
  test("보기 맨 앞의 숫자*만 가중치, 틀린 표기(소수)도 색칠하고 오류는 파서가", () => {
    expect(show("{3*a|b|1.5*c} 3*d { 4*e}")).toEqual(["{1", "weight:3*", "|1", "|1", "weight:1.5*", "}1", "{1", "}1"]);
  });
  test("NAI 강조와 같이 있어도 구분된다", () => {
    expect(show("{2*1.2::wlop ::|x}")).toEqual(["{1", "weight:2*", "nai:1.2::", "nai:::", "|1", "}1"]);
  });
});

describe("바깥 프롬프트 표기", () => {
  test("ComfyUI 강조: 여는 괄호와 :가중치)", () => {
    expect(show("(red hair:1.2), ((smile:0.8))")).toEqual(["comfy:(", "comfy::1.2)", "comfy:(", "comfy::0.8)"]);
  });
  test("ComfyUI의 \\( \\)는 글자라 짝으로 치지 않는다", () => {
    expect(show("hatsune miku \\(cosplay\\)")).toEqual([]);
    expect(show("(miku \\(cosplay\\):1.1)")).toEqual(["comfy:(", "comfy::1.1)"]);
  });
  test("LoRA, BREAK", () => {
    expect(show("<lora:detail:0.6> BREAK 1girl")).toEqual(["lora:<lora:detail:0.6>", "break:BREAK"]);
  });
  test("NAI 숫자 강조: 여는 1.2::와 닫는 ::, 작가 태그의 : 하나는 아님", () => {
    expect(show("1.2::artist:wlop ::, -1::bad::")).toEqual(["nai:1.2::", "nai:::", "nai:-1::", "nai:::"]);
  });
  test("선택지 안에서도 색칠만 하고 선택지 기호는 그대로", () => {
    expect(show("{1.2::artist:wlop ::|(red:1.1)}")).toEqual(["{1", "nai:1.2::", "nai:::", "|1", "comfy:(", "comfy::1.1)", "}1"]);
  });
  test("참조 안의 글자는 바깥 표기로 보지 않는다", () => {
    expect(show("${a::b}")).toEqual(["badref:${a::b}"]);
  });
  test("자동완성 판단(열린 ${)은 바깥 표기가 있어도 그대로", () => {
    expect(openRefBefore("(red:1.2), ${hai")).toEqual({ from: 11, query: "hai" });
  });
});
