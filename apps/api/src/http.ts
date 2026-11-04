// 요청 본문 읽기와 오류 응답. 받은 JSON은 여기서만 파싱한다(DESIGN 9절 "입력과 저장" 1항).

import type { Context } from "hono";
import { hasProtoKey } from "@wakaaka/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** 서비스와 라우트가 던지는 오류. 응답 본문은 { error: { code, message, ...detail } } */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(status: ContentfulStatusCode, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Content-Type에 charset을 명시한다(DESIGN 9절 7항). */
export function json(c: Context, value: unknown, status: ContentfulStatusCode = 200): Response {
  return c.body(JSON.stringify(value), status, { "Content-Type": "application/json; charset=utf-8" });
}

export function errorBody(e: ApiError) {
  return { error: { code: e.code, message: e.message, ...e.detail } };
}

/**
 * JSON 원문에서 같은 객체 안의 중복 키를 찾는다. JSON.parse는 마지막 값을 쓰고 조용히 넘어가므로 따로 본다.
 * 이미 JSON.parse를 통과한 원문만 넣는다. 키는 이스케이프를 풀어서 비교한다("a"와 "a"은 같은 키).
 */
export function findDuplicateKey(text: string): string | null {
  const stack: Array<Set<string> | null> = []; // 객체는 키 집합, 배열은 null
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x22 /* " */) {
      let j = i + 1;
      while (text.charCodeAt(j) !== 0x22) j += text.charCodeAt(j) === 0x5c /* \ */ ? 2 : 1;
      const top = stack[stack.length - 1];
      if (expectKey && top) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.has(key)) return key;
        top.add(key);
        expectKey = false;
      }
      i = j;
    } else if (ch === 0x7b /* { */) {
      stack.push(new Set());
      expectKey = true;
    } else if (ch === 0x5b /* [ */) {
      stack.push(null);
      expectKey = false;
    } else if (ch === 0x7d /* } */ || ch === 0x5d /* ] */) {
      stack.pop();
      expectKey = false;
    } else if (ch === 0x2c /* , */) {
      expectKey = stack[stack.length - 1] != null;
    }
  }
  return null;
}

/**
 * 쓰기 요청의 JSON 본문을 읽는다. 크기 제한은 bodyLimit 미들웨어가 먼저 한다.
 * 순서: Content-Type → JSON.parse → 중복 키 → __proto__ 키. 스키마 검사는 부르는 쪽이 한다.
 */
export async function readJson(c: Context): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new ApiError(415, "E_CONTENT_TYPE", "Content-Type must be application/json");
  const text = await c.req.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "E_JSON", "invalid JSON");
  }
  const dup = findDuplicateKey(text);
  if (dup !== null) throw new ApiError(400, "E_JSON_DUPLICATE_KEY", "duplicate key in JSON object", { key: dup });
  if (hasProtoKey(value)) throw new ApiError(400, "E_SCHEMA", "__proto__ key is not allowed");
  return value;
}
