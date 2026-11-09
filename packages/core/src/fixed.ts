// 고정 표시 (DESIGN 3절 "고정 표시"): 결과가 seed와 상관없이 늘 같은 와일드카드인지.
// 전개 명세가 아니라 화면 표시용이라 공통 테스트 세트에 넣지 않는다(Python 노드는 쓰지 않는다).

import { isCommentItem, parse, type ParseMode } from "./parser.ts";

/** 저장 문서와 편집기 문서 둘 다 받도록 쓰는 필드만 적는다 */
export interface FixedDocLike {
  select?: { count?: readonly [number, number] | undefined } | undefined;
  items: ReadonlyArray<{ text?: string | undefined; ref?: unknown; w?: number | undefined }>;
}

/**
 * 주석을 뺀 항목이 1개이고, ref 항목이 아니고, 가중치가 0이 아니고, 텍스트가 참조·선택지 없이 글자뿐이고,
 * 개수 최솟값이 1 이상이면 고정. 텍스트가 비었거나 공백뿐이면(빈 와일드카드와 같다) 고정이 아니다.
 * mode: 저장 문서는 "stored"(참조가 `${w:ID}`), 편집 중인 문서는 "edit"(이름 참조도 참조로 본다).
 */
export function isFixedDoc(doc: FixedDocLike, mode: ParseMode = "stored"): boolean {
  const min = doc.select?.count?.[0] ?? 1;
  if (min < 1) return false;
  const live = doc.items.filter((it) => !isCommentItem(it));
  if (live.length !== 1) return false;
  const it = live[0]!;
  if (it.ref !== undefined || it.text === undefined || (it.w ?? 1) === 0) return false;
  if (it.text.trim() === "") return false;
  const p = parse(it.text, mode);
  return p.ok && p.nodes.every((n) => n.type === "text");
}
