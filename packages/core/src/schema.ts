// 문서와 묶음 스키마 (SPEC 3절, DESIGN 9절 "입력과 저장").
//
// 두 층이 있다.
// - expandDocSchema: 전개기가 쓰는 SPEC 3.1 규칙. 모르는 필드는 무시한다(Python 전개기와 같아야 한다).
// - docSchema / bundleSchema: API 저장과 묶음 수신용 엄격 스키마(SPEC 3.3). 모르는 필드와 위험한 문자열을 거부한다.
// 어느 쪽도 기본값을 채우지 않는다. 통과한 결과는 받은 모양 그대로이고, 기본값은 전개기가 읽을 때 쓴다.

import { z } from "zod";

export const MAX_ITEMS = 5000;
export const MAX_COUNT = 5000;
export const MAX_WEIGHT = 1_000_000;

export const BASE62_12 = /^[0-9A-Za-z]{12}$/;
export const ITEM_ID = /^[0-9A-Za-z]{1,16}$/;
/** 와일드카드 이름에 쓸 수 없는 글자 (DESIGN 3절, 잠정) */
export const NAME_FORBIDDEN = /[{}$\\|=:]/;

/**
 * 문자열 검사 (DESIGN 9절 2항): 올바른 유니코드(짝 없는 서로게이트 없음), U+0000 없음,
 * 탭·줄바꿈·CR을 뺀 C0 제어문자 없음.
 */
export function isSafeString(s: string): boolean {
  if (!s.isWellFormed()) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
  }
  return true;
}

/** 객체 어디에든 자기 키 `__proto__`가 있는지. zod의 record는 이 키를 오류 없이 빼 버린다(NOTES). */
export function hasProtoKey(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    if (Object.hasOwn(v, "__proto__")) return true;
    for (const x of Object.values(v)) stack.push(x);
  }
  return false;
}

const isBlank = (s: string) => /^[ \t\n\r]*$/.test(s);

// 전개용과 저장용이 같이 쓰는 부분. 두 스키마를 한 함수에서 갈래로 돌려주면 반환 타입이 합 타입이 되어
// z.infer가 공통 키만 남긴다(name/description이 빠짐, NOTES Phase 2). 그래서 부품만 여기서 만들고 조립은 따로 한다.
function docParts(strict: boolean) {
  const obj = strict ? z.strictObject : z.object;
  const str = strict ? z.string().refine(isSafeString, { message: "invalid string" }) : z.string();
  const int = (min: number, max: number) => z.int().min(min).max(max);

  const ref = z.strictObject({ wildcard: z.string().regex(BASE62_12) });
  const item = obj({
    id: z.string().regex(ITEM_ID),
    text: str.optional(),
    ref: ref.optional(),
    w: int(0, MAX_WEIGHT).optional(),
    spread: z.boolean().optional(),
  }).superRefine((it, ctx) => {
    if ((it.text === undefined) === (it.ref === undefined)) ctx.addIssue({ code: "custom", message: "exactly one of text and ref" });
    if (it.spread !== undefined && it.ref === undefined) ctx.addIssue({ code: "custom", path: ["spread"], message: "spread only on ref items" });
    if (it.spread === true && it.w !== undefined) ctx.addIssue({ code: "custom", path: ["w"], message: "w not allowed on spread items" });
  });
  const select = obj({
    count: z.tuple([int(0, MAX_COUNT), int(0, MAX_COUNT)]).optional(),
    sep: str.optional(),
  }).superRefine((s, ctx) => {
    if (s.count !== undefined && s.count[0] > s.count[1]) ctx.addIssue({ code: "custom", path: ["count"], message: "min > max" });
  });
  const shape = {
    schema: z.literal(1),
    select: select.optional(),
    items: z.array(item).max(MAX_ITEMS),
  };
  const docItemsUnique = (d: { items: Array<{ id: string }> }, ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    d.items.forEach((it, i) => {
      if (seen.has(it.id)) ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: "duplicate item id" });
      seen.add(it.id);
    });
  };
  return { str, shape, docItemsUnique };
}

function makeExpandDocSchema() {
  const { shape, docItemsUnique } = docParts(false);
  return z.object(shape).superRefine(docItemsUnique);
}

function makeStoredDocSchema() {
  const { str, shape, docItemsUnique } = docParts(true);
  return z.strictObject({
    ...shape,
    name: str
      .refine((s) => !isBlank(s), { message: "blank name" })
      .refine((s) => !NAME_FORBIDDEN.test(s), { message: "forbidden character in name" })
      .optional(),
    description: str.optional(),
  }).superRefine(docItemsUnique);
}

/** 전개기용 문서 스키마 (SPEC 3.1). 실패하면 E_DOC. */
export const expandDocSchema = makeExpandDocSchema();
/** 저장용 엄격 문서 스키마 (SPEC 3.3). */
export const docSchema = makeStoredDocSchema();

export type ExpandDoc = z.infer<typeof expandDocSchema>;
export type Doc = z.infer<typeof docSchema>;
export type DocItem = Doc["items"][number];

/** 묶음 수신용 엄격 스키마 (DESIGN 7절). 문서 키와 lock 값의 해시 대조는 따로 한다. */
export const bundleSchema = z
  .unknown()
  .refine((v) => !hasProtoKey(v), { message: "__proto__ key" })
  .pipe(
    z.strictObject({
      format: z.literal(1),
      root: z.string().regex(BASE62_12),
      lock: z.record(z.string().regex(BASE62_12), z.string().regex(BASE62_12)),
      docs: z.record(z.string().regex(BASE62_12), docSchema),
    }),
  );
export type Bundle = z.infer<typeof bundleSchema>;
