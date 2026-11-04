import { describe, expect, test } from "vitest";
import { cleanup, cleanupWithMap } from "../src/cleanup.ts";
import { bounded, derive, fnv1a64, H, mix64, sampleWithoutReplacement, SplitMix64 } from "../src/random.ts";
import { loadJson } from "./conformance.ts";

const p = loadJson("primitives.json");
const hex = (v: bigint) => v.toString(16).padStart(16, "0");
const utf8 = new TextEncoder();
const rows = (cs: any[], label: (c: any) => string): Array<[string, any]> => cs.map((c) => [label(c), c]);

describe("conformance: primitives.json", () => {
  test("벡터 수", () => {
    const n = ["fnv1a64", "mix64", "splitmix64", "derive", "H", "bounded", "sample", "cleanup"].reduce((a, g) => a + p[g].length, 0);
    expect(n).toBe(56);
  });
  test.each(rows(p.fnv1a64, (c) => JSON.stringify(c.in)))("fnv1a64 %s", (_, c: any) => {
    expect(hex(fnv1a64(utf8.encode(c.in)))).toBe(c.out);
  });
  test.each(rows(p.mix64, (c) => c.in))("mix64 %s", (_, c: any) => {
    expect(hex(mix64(BigInt("0x" + c.in)))).toBe(c.out);
  });
  test.each(rows(p.splitmix64, (c) => c.seed))("splitmix64 seed %s", (_, c: any) => {
    const rng = new SplitMix64(BigInt(c.seed));
    expect(c.out.map(() => hex(rng.next()))).toEqual(c.out);
  });
  test.each(rows(p.derive, (c) => `${c.seed} ${c.label}`))("derive %s", (_, c: any) => {
    expect(hex(derive(BigInt(c.seed), c.label))).toBe(c.out);
  });
  test.each(rows(p.H, (c) => `${c.seed} [${c.labels.join(", ")}]`))("H %s", (_, c: any) => {
    expect(hex(H(BigInt(c.seed), c.labels))).toBe(c.out);
  });
  test.each(rows(p.bounded, (c) => c.seed))("bounded seed %s", (_, c: any) => {
    const rng = new SplitMix64(BigInt(c.seed));
    expect(c.n.map((n: string) => bounded(rng, BigInt(n)).toString())).toEqual(c.out);
  });
  test.each(rows(p.sample, (c) => `seed ${c.seed} [${c.weights}] k=${c.k}`))("sample %s", (_, c: any) => {
    const rng = new SplitMix64(BigInt(c.seed));
    expect(sampleWithoutReplacement(rng, c.weights.map(BigInt), c.k)).toEqual(c.out);
  });
  test.each(rows(p.cleanup, (c) => JSON.stringify(c.in)))("cleanup %s", (_, c: any) => {
    expect(cleanup(c.in)).toBe(c.out);
    expect(cleanupWithMap(c.in).text).toBe(c.out);
  });
});
