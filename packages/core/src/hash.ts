// 내용 해시 (SPEC 7절): JCS → sha256 → base62 앞 12자.
// node:crypto를 써서 서버(API)와 도구 전용이다. 웹 번들이 가져가지 않게 index.ts에서 내보내지 않고 "@wakaaka/core/hash"로 쓴다.

import { createHash } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * RFC 8785 정규화. 문서에 나오는 값(정수, 문자열, 불리언, null, 배열, 객체)만 받는다.
 * 문자열 이스케이프와 정수 표기는 JSON.stringify가 RFC 8785와 같다(ECMAScript 직렬화가 RFC의 정의다).
 */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new TypeError(`canonicalize: not a safe integer: ${v}`);
    return JSON.stringify(v); // -0 → "0"
  }
  if (typeof v === "string") {
    if (!v.isWellFormed()) throw new TypeError("canonicalize: lone surrogate");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (typeof v === "object") {
    // 기본 sort는 UTF-16 코드 단위 순이다.
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => canonicalize(k) + ":" + canonicalize((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  throw new TypeError(`canonicalize: unsupported value: ${typeof v}`);
}

/** 32바이트를 빅엔디언 정수로 읽어 62진법 43자로 쓴다 (앞을 "0"으로 채움). */
export function base62of256(digest: Uint8Array): string {
  if (digest.length !== 32) throw new RangeError("base62of256: need 32 bytes");
  let n = BigInt("0x" + Buffer.from(digest).toString("hex"));
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 62n)]! + s;
    n /= 62n;
  }
  return s.padStart(43, "0");
}

export function sha256(text: string): Uint8Array {
  return createHash("sha256").update(text, "utf8").digest();
}

/** 저장 형식(SPEC 3.3)을 통과한 문서의 내용 해시 12자. */
export function contentHash(doc: unknown): string {
  return base62of256(sha256(canonicalize(doc))).slice(0, 12);
}
