// 최종 결과 쉼표 정리 (SPEC 4.4). 공백은 SPEC 1절의 네 글자뿐이다. String.prototype.trim은 쓰지 않는다.

export function isSpecWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isBlank(s: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (!isSpecWhitespace(s.charCodeAt(i))) return false;
  return true;
}

export function trimSpecWhitespace(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isSpecWhitespace(s.charCodeAt(a))) a++;
  while (b > a && isSpecWhitespace(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

export interface CleanupResult {
  text: string;
  /** 원래 문자열의 UTF-16 오프셋 x(0 ≤ x ≤ 원래 길이) → 정리된 문자열의 오프셋. */
  map(x: number): number;
}

/**
 * 결과는 원래 문자열에서 글자 일부를 지운 것이다. 지운 글자를 표시해 두고 위치를 옮긴다.
 * 지운 조각의 쉼표는 남은 조각 사이에 쉼표가 하나씩만 남도록, 남은 조각 바로 뒤의 쉼표를 남기는 쪽으로 고른다.
 */
export function cleanupWithMap(s: string): CleanupResult {
  const parts: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || s.charCodeAt(i) === 0x2c) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  const keptParts = parts.filter(([a, b]) => !isBlank(s, a, b));
  const keep = new Uint8Array(s.length);
  keptParts.forEach(([a, b], j) => {
    // 마지막이 아닌 남은 조각은 바로 뒤의 쉼표(위치 b)도 남긴다.
    const end = j < keptParts.length - 1 ? b + 1 : b;
    keep.fill(1, a, end);
  });
  // 앞뒤 공백. 남은 조각은 공백뿐이 아니므로 첫 조각과 마지막 조각 안에서 멈춘다.
  if (keptParts.length > 0) {
    let a = keptParts[0]![0];
    while (isSpecWhitespace(s.charCodeAt(a))) keep[a++] = 0;
    let b = keptParts[keptParts.length - 1]![1];
    while (isSpecWhitespace(s.charCodeAt(b - 1))) keep[--b] = 0;
  }
  const prefix = new Uint32Array(s.length + 1);
  let out = "";
  let runStart = -1;
  for (let i = 0; i < s.length; i++) {
    prefix[i + 1] = prefix[i]! + keep[i]!;
    if (keep[i] && runStart < 0) runStart = i;
    if (!keep[i] && runStart >= 0) {
      out += s.slice(runStart, i);
      runStart = -1;
    }
  }
  if (runStart >= 0) out += s.slice(runStart);
  return { text: out, map: (x) => prefix[x]! };
}

/** SPEC 4.4 cleanup를 명세 그대로 옮긴 것. cleanupWithMap과 결과가 같아야 한다(단위 테스트에서 비교). */
export function cleanup(s: string): string {
  const parts = s.split(",").filter((p) => !isBlank(p, 0, p.length));
  return trimSpecWhitespace(parts.join(","));
}
