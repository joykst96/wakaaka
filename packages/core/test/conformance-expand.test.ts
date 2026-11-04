import { describe, expect, test } from "vitest";
import { expand } from "../src/expand.ts";
import { loadExpandCases } from "./conformance.ts";

const cases = loadExpandCases();

describe("conformance: expand/*.json", () => {
  test("사례 수와 실행 수", () => {
    expect(cases.length).toBe(46);
    expect(cases.reduce((n, c) => n + c.runs.length, 0)).toBe(243);
  });
  for (const c of cases) {
    test.each(c.runs.map((r) => [r.seed, r] as const))(`${c.file} seed %s`, (_, r) => {
      const got = expand(c.bundle, r.seed, { limits: c.limits ?? {} });
      if (r.error !== undefined) expect(got.ok ? { text: got.text } : got.error.code).toBe(r.error);
      else expect(got.ok ? got.text : { error: got.error }).toBe(r.text);
    });
  }
});
