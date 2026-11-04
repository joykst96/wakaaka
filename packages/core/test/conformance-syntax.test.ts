import { describe, expect, test } from "vitest";
import { parse, toCommonAst, type ParseMode } from "../src/parser.ts";
import { loadJson } from "./conformance.ts";

interface SyntaxCase {
  name: string;
  text: string;
  mode?: ParseMode;
  expect: { ast?: unknown[]; error?: string; ok?: true };
}

const { cases } = loadJson<{ cases: SyntaxCase[] }>("syntax.json");

describe("conformance: syntax.json", () => {
  test("사례 수", () => expect(cases.length).toBe(83));
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const r = parse(c.text, c.mode ?? "stored");
    if (c.expect.error !== undefined) {
      expect(r.ok ? "ok" : r.error.code).toBe(c.expect.error);
    } else {
      expect(r.ok ? "ok" : r.error.code).toBe("ok");
      if (r.ok && c.expect.ast !== undefined) expect(toCommonAst(r.nodes)).toEqual(c.expect.ast);
    }
  });
});
