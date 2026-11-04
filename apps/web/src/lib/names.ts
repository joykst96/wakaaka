// 이름 참조 `${이름}` → `${w:ID}` (DESIGN 11절, 사용자 결정 2026-11-03).
// 내 와일드카드에 같은 이름(대소문자 무시)이 있으면 그것. 없으면 부르는 쪽이 후보 창을 띄워 고르게 한다.
// 바꾸기는 파서가 준 위치로 한다. 정규식 치환은 이스케이프된 `\${`를 잘못 바꿀 수 있다.

import { collectRefs, parse } from "@wakaaka/core";
import type { EditItem } from "./editdoc.ts";

/** 이름 비교 키. API의 유일 색인은 lower(name)이다 */
export const nameKey = (name: string) => name.toLowerCase();

/** 항목들의 이름 참조. 키(소문자) → 처음 쓴 표기. 문법 오류가 있는 항목은 건너뛴다(오류는 따로 표시한다) */
export function nameRefs(items: readonly EditItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const it of items) {
    if (it.text === undefined) continue;
    const p = parse(it.text, "edit");
    if (!p.ok) continue;
    for (const r of collectRefs(p.nodes)) if (r.kind === "name" && !out.has(nameKey(r.name))) out.set(nameKey(r.name), r.name);
  }
  return out;
}

/** 텍스트의 이름 참조를 바꾼다. resolve가 undefined를 내면 그 참조는 그대로 둔다 */
export function rewriteNames(text: string, resolve: (name: string) => string | undefined): string {
  const p = parse(text, "edit");
  if (!p.ok) return text;
  let out = "";
  let at = 0;
  for (const r of collectRefs(p.nodes).sort((a, b) => a.start - b.start)) {
    if (r.kind !== "name") continue;
    const id = resolve(r.name);
    if (id === undefined) continue;
    out += text.slice(at, r.start) + "${w:" + id + "}";
    at = r.end;
  }
  return out + text.slice(at);
}

export function rewriteItems(items: readonly EditItem[], resolve: (name: string) => string | undefined): EditItem[] {
  return items.map((it) => (it.text === undefined ? it : { ...it, text: rewriteNames(it.text, resolve) }));
}

/** 이름 → 내 와일드카드 ID (대소문자 무시). 내 것 안에서는 이름이 유일하다 */
export function mineByName(mine: ReadonlyArray<{ id: string; name: string }>): Map<string, string> {
  return new Map(mine.map((w) => [nameKey(w.name), w.id]));
}
