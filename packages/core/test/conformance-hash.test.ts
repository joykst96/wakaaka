import { describe, expect, test } from "vitest";
import { base62of256, canonicalize, contentHash, sha256 } from "../src/hash.ts";
import { docSchema } from "../src/schema.ts";
import { loadJson } from "./conformance.ts";

interface HashVectors {
  base62: Array<{ name: string; in: string; out: string }>;
  jcs: Array<{ name: string; input: string; out: string }>;
  hash: Array<{ name: string; input: string; jcs: string; sha256: string; out: string }>;
}

const v = loadJson<HashVectors>("hash.json");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("conformance: hash.json", () => {
  test("벡터 수", () => expect(v.base62.length + v.jcs.length + v.hash.length).toBe(19));
  test.each(v.base62.map((c) => [c.name, c] as const))("base62 %s", (_, c) => {
    expect(base62of256(Buffer.from(c.in, "hex"))).toBe(c.out);
  });
  test.each(v.jcs.map((c) => [c.name, c] as const))("jcs %s", (_, c) => {
    expect(canonicalize(JSON.parse(c.input))).toBe(c.out);
  });
  test.each(v.hash.map((c) => [c.name, c] as const))("hash %s", (_, c) => {
    const doc = JSON.parse(c.input);
    expect(docSchema.safeParse(doc).success).toBe(true);
    expect(canonicalize(doc)).toBe(c.jcs);
    expect(hex(sha256(c.jcs))).toBe(c.sha256);
    expect(contentHash(doc)).toBe(c.out);
    // 스키마를 통과한 결과로 계산해도 같다(기본값을 채우지 않는다).
    expect(contentHash(docSchema.parse(doc))).toBe(c.out);
  });
});
