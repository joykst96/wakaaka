// 문법 가이드의 예시가 실제 문법·전개와 맞는지 (가이드 문장이 어긋나지 않게)

import { expand, parse } from "@wakaaka/core";
import { describe, expect, test } from "vitest";
import { exampleBundle, exampleOutputs, GUIDE } from "../src/lib/guide.ts";
import { linePrefixLength } from "../src/lib/textview.ts";

const all = GUIDE.flatMap((s) => s.examples.map((ex) => ({ step: s.title, ex })));

describe("문법 가이드", () => {
  test.each(all.map((a) => [a.step, a.ex.code, a.ex] as const))("%s: %j는 문법 오류 없이 전개된다", (_s, _c, ex) => {
    for (const line of ex.code.split("\n")) expect(parse(line.slice(linePrefixLength(line)), "edit").ok).toBe(true);
    const outs = exampleOutputs(ex);
    expect(outs.length).toBeGreaterThan(0);
    expect(outs.join("\n")).not.toContain("(오류");
  });

  const freq = (ex: (typeof all)[number]["ex"], n = 4000) => {
    const b = exampleBundle(ex);
    const m = new Map<string, number>();
    for (let s = 0; s < n; s++) {
      const r = expand(b, BigInt(s));
      if (r.ok) m.set(r.text, (m.get(r.text) ?? 0) + 1);
    }
    return m;
  };
  const find = (code: string) => all.find((a) => a.ex.code === code)!.ex;

  test("가중치 3은 약 3배 (항목과 뽑기)", () => {
    const m = freq(find("red hair\nblue hair\n3* black hair"));
    expect(m.get("black hair")! / m.get("red hair")!).toBeGreaterThan(2.5);
    expect(m.get("black hair")! / m.get("red hair")!).toBeLessThan(3.5);
  });

  test("보기 가중치 3:1과 0, hair tint 와일드카드도 3:1 (보기 가중치)", () => {
    const rep = freq(find("{3*silver|platinum} hair"));
    expect(rep.get("silver hair")! / rep.get("platinum hair")!).toBeGreaterThan(2.6);
    expect(rep.get("silver hair")! / rep.get("platinum hair")!).toBeLessThan(3.4);
    const zero = freq(find("{5*smile|2*grin|0*frown}"));
    expect(new Set(zero.keys())).toEqual(new Set(["smile", "grin"]));
    const tint = freq(find("${hair tint} hair"));
    expect(tint.get("silver hair")! / tint.get("platinum hair")!).toBeGreaterThan(2.6);
    expect(tint.get("silver hair")! / tint.get("platinum hair")!).toBeLessThan(3.4);
  });

  test("펼치면 후보 4개, bald는 약 1/4", () => {
    const m = freq(find("bald"));
    expect(new Set(m.keys())).toEqual(new Set(["bald", "red hair", "silver hair", "black hair"]));
    expect(m.get("bald")! / 4000).toBeGreaterThan(0.2);
    expect(m.get("bald")! / 4000).toBeLessThan(0.3);
  });

  test("이스케이프와 빈 보기 정리", () => {
    expect(exampleOutputs(find("\\{literal braces\\}, 100\\$, hatsune miku \\(cosplay\\)"))).toEqual(["{literal braces}, 100$, hatsune miku \\(cosplay\\)"]);
    expect(new Set(exampleOutputs(find("{:\\||\\m/}")))).toEqual(new Set([":|", "\\m/"]));
    expect(new Set(exampleOutputs(find("1girl, {|smile}, standing")))).toEqual(new Set(["1girl, standing", "1girl, smile, standing"]));
  });
});
