// 편집기의 문서 모델. 저장 형태(core Doc)와 서로 바꾼다.
// 필드가 있는지 없는지를 그대로 지킨다: core는 기본값을 채우지 않고 받은 모양 그대로 해시하므로(NOTES Phase 1),
// select를 생략한 문서에 편집기가 기본값을 적어 넣으면 아무것도 안 고쳐도 새 버전이 생긴다.

import type { Doc } from "@wakaaka/core";

export interface EditItem {
  id: string;
  /** 텍스트 항목. 편집 형태라 이름 참조 `${이름}`이 남아 있을 수 있다 */
  text?: string;
  /** 항목 전체가 참조(내 와일드카드 ID) */
  ref?: string;
  spread?: boolean;
  w?: number;
}

export interface EditDoc {
  name: string;
  description?: string;
  count?: [number, number];
  sep?: string;
  items: EditItem[];
}

export const DEFAULT_COUNT: [number, number] = [1, 1];
export const DEFAULT_SEP = ", ";

export function fromDoc(d: Doc): EditDoc {
  const e: EditDoc = { name: d.name ?? "", items: d.items.map(fromItem) };
  if (d.description !== undefined) e.description = d.description;
  if (d.select?.count !== undefined) e.count = [d.select.count[0], d.select.count[1]];
  if (d.select?.sep !== undefined) e.sep = d.select.sep;
  return e;
}

function fromItem(it: Doc["items"][number]): EditItem {
  const e: EditItem = { id: it.id };
  if (it.text !== undefined) e.text = it.text;
  if (it.ref !== undefined) e.ref = it.ref.wildcard;
  if (it.spread !== undefined) e.spread = it.spread;
  if (it.w !== undefined) e.w = it.w;
  return e;
}

/** 저장할 문서. 이름 참조는 부르는 쪽이 먼저 바꿔 둔다(names.ts). 빈 설명은 넣지 않는다 */
export function toDoc(e: EditDoc): Doc {
  const d: Doc = { schema: 1, name: e.name, items: e.items.map(toItem) };
  if (e.description !== undefined && e.description !== "") d.description = e.description;
  if (e.count !== undefined || e.sep !== undefined) {
    d.select = {};
    if (e.count !== undefined) d.select.count = [e.count[0], e.count[1]];
    if (e.sep !== undefined) d.select.sep = e.sep;
  }
  return d;
}

function toItem(e: EditItem): Doc["items"][number] {
  const it: Doc["items"][number] = { id: e.id };
  if (e.ref !== undefined) {
    it.ref = { wildcard: e.ref };
    if (e.spread !== undefined) it.spread = e.spread;
  } else {
    it.text = e.text ?? "";
  }
  if (e.w !== undefined && !(e.ref !== undefined && e.spread === true)) it.w = e.w;
  return it;
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 항목 ID: base62 4자 무작위, 문서 안에서 겹치지 않게. 하위 seed 경로가 이 ID를 쓰므로 한 번 정하면 바꾸지 않는다 */
export function newItemId(taken: ReadonlySet<string>, random: (n: number) => Uint8Array = randomBytes): string {
  for (let len = 4; ; len++) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = [...random(len)].map((b) => B62[b % 62]).join("");
      if (!taken.has(id)) return id;
    }
  }
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 두 편집 문서가 저장했을 때 같은 문서인지 (저장 안 됨 표시용) */
export function sameDoc(a: EditDoc, b: EditDoc): boolean {
  return JSON.stringify(toDoc(a)) === JSON.stringify(toDoc(b));
}
