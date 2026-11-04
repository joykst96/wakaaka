// 스키마 단위 테스트: 저장용 엄격 스키마(SPEC 3.3, DESIGN 9절 "입력과 저장")와 전개용 스키마(SPEC 3.1).

import { describe, expect, expectTypeOf, test } from "vitest";
import { bundleSchema, docSchema, expandDocSchema, hasProtoKey, isSafeString, type Doc, type DocItem, type ExpandDoc } from "../src/schema.ts";

const ok = (v: unknown) => docSchema.safeParse(v).success;
const okJson = (text: string) => docSchema.safeParse(JSON.parse(text)).success;
const base = { schema: 1, items: [{ id: "a", text: "x" }] };
const withItem = (it: object) => ({ schema: 1, items: [it] });

describe("문자열 검사", () => {
  test.each([
    ["a\u0000b", false],
    ["\ud800", false],
    ["a\udc00", false],
    ["\u0001", false],
    ["\u001f", false],
    ["\u001b[31m", false],
    ["tab\tline\ncr\r", true],
    ["\u007f \u0085   ﻿", true], // C0만 거부한다(잠정)
    ["😀 한글", true],
    ["", true],
  ])("%j → %s", (s, expected) => {
    expect(isSafeString(s)).toBe(expected);
    // 문서 안의 모든 문자열 자리에 적용된다
    expect(ok(withItem({ id: "a", text: s }))).toBe(expected);
    expect(ok({ ...base, select: { sep: s } })).toBe(expected);
    expect(ok({ ...base, description: s })).toBe(expected);
  });

  test("JSON 이스케이프로 들어온 U+0000과 짝 없는 서로게이트", () => {
    expect(okJson('{"schema":1,"items":[{"id":"a","text":"a\\u0000b"}]}')).toBe(false);
    expect(okJson('{"schema":1,"items":[{"id":"a","text":"\\ud800"}]}')).toBe(false);
    expect(okJson('{"schema":1,"items":[{"id":"a","text":"\\ud83d\\ude00"}]}')).toBe(true);
  });
});

describe("모르는 필드와 __proto__", () => {
  test.each([
    ["문서", { ...base, extra: 1 }],
    ["select", { ...base, select: { count: [1, 1], extra: 1 } }],
    ["select.order (예약, 지금은 거부)", { ...base, select: { order: "listed" } }],
    ["항목", withItem({ id: "a", text: "x", note: "y" })],
    ["ref", withItem({ id: "a", ref: { wildcard: "abcdefghijkl", hash: "abcdefghijkl" } })],
    ["예전 해시 참조", withItem({ id: "a", ref: { hash: "abcdefghijkl" } })],
  ])("%s", (_, v) => {
    expect(ok(v)).toBe(false);
  });

  test.each([
    ["문서", '{"schema":1,"items":[],"__proto__":{"polluted":1}}'],
    ["문서(값이 스칼라)", '{"schema":1,"items":[],"__proto__":1}'],
    ["select", '{"schema":1,"items":[],"select":{"__proto__":{"count":[0,0]}}}'],
    ["항목", '{"schema":1,"items":[{"id":"a","text":"x","__proto__":{"w":0}}]}'],
    ["ref", '{"schema":1,"items":[{"id":"a","ref":{"wildcard":"abcdefghijkl","__proto__":{}}}]}'],
    ["constructor", '{"schema":1,"items":[],"constructor":{"prototype":{"x":1}}}'],
  ])("JSON.parse로 만든 %s의 __proto__/constructor 키는 거부", (_, text) => {
    expect(okJson(text)).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  test("통과한 결과는 새 객체이고 기본값을 채우지 않는다", () => {
    const input = JSON.parse('{"schema":1,"items":[{"id":"a","text":"x"}]}');
    const out = docSchema.parse(input);
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
    expect(Object.keys(out)).toEqual(["schema", "items"]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  test("묶음: zod record는 __proto__ 키를 조용히 빼므로 먼저 따로 거부한다", () => {
    const doc = { schema: 1, items: [] };
    const good = { format: 1, root: "root00000000", lock: { Wa0000000000: "root00000000" }, docs: { root00000000: doc } };
    expect(bundleSchema.safeParse(good).success).toBe(true);
    const lockProto = JSON.parse('{"format":1,"root":"root00000000","lock":{"__proto__":"root00000000"},"docs":{"root00000000":{"schema":1,"items":[]}}}');
    const docsProto = JSON.parse('{"format":1,"root":"root00000000","lock":{},"docs":{"root00000000":{"schema":1,"items":[]},"__proto__":{"schema":1,"items":[]}}}');
    expect(hasProtoKey(lockProto) && hasProtoKey(docsProto)).toBe(true);
    expect(bundleSchema.safeParse(lockProto).success).toBe(false);
    expect(bundleSchema.safeParse(docsProto).success).toBe(false);
    expect(bundleSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(bundleSchema.safeParse({ ...good, format: 2 }).success).toBe(false);
    expect(bundleSchema.safeParse({ ...good, lock: { short: "root00000000" } }).success).toBe(false);
  });
});

describe("수", () => {
  test.each([
    ['{"schema":1,"items":[{"id":"a","text":"x","w":3.0}]}', true], // 소수부 0은 정수
    ['{"schema":1.0,"items":[]}', true],
    ['{"schema":1,"items":[{"id":"a","text":"x","w":1e400}]}', false], // JS에서 Infinity
    ['{"schema":1,"items":[{"id":"a","text":"x","w":0.5}]}', false],
    ['{"schema":1,"items":[{"id":"a","text":"x","w":-1}]}', false],
    ['{"schema":1,"items":[{"id":"a","text":"x","w":1000001}]}', false],
    ['{"schema":1,"items":[{"id":"a","text":"x","w":1000000}]}', true],
    ['{"schema":1,"items":[{"id":"a","text":"x","w":"3"}]}', false],
    ['{"schema":2,"items":[]}', false],
    ['{"schema":1,"select":{"count":[2,1]},"items":[]}', false],
    ['{"schema":1,"select":{"count":[0,5001]},"items":[]}', false],
    ['{"schema":1,"select":{"count":[1]},"items":[]}', false],
    ['{"schema":1,"select":{"count":[1,2,3]},"items":[]}', false],
  ])("%s → %s", (text, expected) => {
    expect(okJson(text)).toBe(expected);
  });
});

describe("항목 규칙 (두 스키마 공통)", () => {
  test.each([
    ["text와 ref 둘 다", { id: "a", text: "x", ref: { wildcard: "abcdefghijkl" } }],
    ["둘 다 없음", { id: "a" }],
    ["text 항목의 spread (false여도)", { id: "a", text: "x", spread: false }],
    ["spread 항목의 w (1이어도)", { id: "a", ref: { wildcard: "abcdefghijkl" }, spread: true, w: 1 }],
    ["id가 base62 아님", { id: "a-b", text: "x" }],
    ["id 17자", { id: "a".repeat(17), text: "x" }],
    ["wildcard 11자", { id: "a", ref: { wildcard: "abcdefghijk" } }],
  ])("%s → 거부", (_, it) => {
    expect(ok(withItem(it))).toBe(false);
    expect(expandDocSchema.safeParse(withItem(it)).success).toBe(false);
  });

  test("허용", () => {
    expect(ok(withItem({ id: "a", ref: { wildcard: "abcdefghijkl" }, spread: false, w: 2 }))).toBe(true);
    expect(ok(withItem({ id: "a", ref: { wildcard: "abcdefghijkl" }, spread: true }))).toBe(true);
    expect(ok(withItem({ id: "a".repeat(16), text: "" }))).toBe(true);
  });

  test("id 중복", () => {
    const d = { schema: 1, items: [{ id: "a", text: "x" }, { id: "a", text: "y" }] };
    expect(ok(d)).toBe(false);
    expect(expandDocSchema.safeParse(d).success).toBe(false);
  });

  test("항목 5000개까지", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "i" + i, text: "x" }));
    expect(ok({ schema: 1, items: items(5000) })).toBe(true);
    expect(ok({ schema: 1, items: items(5001) })).toBe(false);
  });
});

describe("이름", () => {
  test.each([
    ["hair color", true],
    ["머리색 (긴)", true],
    ["", false],
    [" \t", false],
    ...["{", "}", "$", "\\", "|", "=", ":"].map((ch) => [`a${ch}b`, false] as [string, boolean]),
  ])("%j → %s", (name, expected) => {
    expect(ok({ ...base, name })).toBe(expected);
  });
});

describe("전개용 스키마는 모르는 필드를 무시한다 (SPEC 3.1)", () => {
  test("문서·select·항목의 모르는 필드는 통과하고 결과에서 빠진다", () => {
    const r = expandDocSchema.safeParse({
      schema: 1,
      note: 1,
      select: { count: [1, 1], order: "listed" },
      items: [{ id: "a", text: "x", comment: "y" }],
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ schema: 1, select: { count: [1, 1] }, items: [{ id: "a", text: "x" }] });
  });
  test("ref 객체는 예외", () => {
    expect(expandDocSchema.safeParse(withItem({ id: "a", ref: { wildcard: "abcdefghijkl", x: 1 } })).success).toBe(false);
  });
  test("문자열 검사는 하지 않는다 (Python 전개기와 같게)", () => {
    expect(expandDocSchema.safeParse(withItem({ id: "a", text: "a\u0001b" })).success).toBe(true);
  });
});

describe("타입 (NOTES Phase 2: 합 타입 때문에 name/description이 빠지던 문제)", () => {
  test("Doc에는 name과 description이 있고 ExpandDoc에는 없다", () => {
    expectTypeOf<Doc>().toHaveProperty("name").toEqualTypeOf<string | undefined>();
    expectTypeOf<Doc>().toHaveProperty("description").toEqualTypeOf<string | undefined>();
    expectTypeOf<ExpandDoc>().not.toHaveProperty("name");
    expectTypeOf<DocItem>().toHaveProperty("ref").toEqualTypeOf<{ wildcard: string } | undefined>();
  });
});
