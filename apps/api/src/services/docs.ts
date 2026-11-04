// 문서 다시 만들기: 가져오기와 시드가 참조 ID를 바꿔 쓸 때 쓴다.
// 받은 객체를 병합하지 않고, 스키마를 통과한 값에서 필드를 하나씩 골라 새 객체를 만든다(DESIGN 9절 4항).

import { randomBytes } from "node:crypto";
import { collectRefs, docSchema, parse, type Doc, type DocItem } from "@wakaaka/core";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 와일드카드 ID: base62 12자, 균등 (248 이상인 바이트는 버린다) */
export function newWildcardId(): string {
  let s = "";
  while (s.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < 248 && s.length < 12) s += B62[b % 62];
    }
  }
  return s;
}

/** 텍스트 안의 ${w:ID}를 mapId(ID)로 바꾼다. 위치는 파서가 준 것을 쓴다(정규식으로 찾지 않는다) */
export function rewriteText(text: string, mapId: (id: string) => string): string {
  const p = parse(text, "stored");
  if (!p.ok) throw new Error(`rewriteText: syntax error ${p.error.code}`);
  let out = "";
  let at = 0;
  for (const r of collectRefs(p.nodes).sort((a, b) => a.start - b.start)) {
    if (r.kind !== "w") continue;
    out += text.slice(at, r.start) + "${w:" + mapId(r.id) + "}";
    at = r.end;
  }
  return out + text.slice(at);
}

function rebuildItem(it: DocItem, mapId: (id: string) => string): DocItem {
  const out: DocItem = { id: it.id };
  if (it.text !== undefined) out.text = rewriteText(it.text, mapId);
  if (it.ref !== undefined) out.ref = { wildcard: mapId(it.ref.wildcard) };
  if (it.w !== undefined) out.w = it.w;
  if (it.spread !== undefined) out.spread = it.spread;
  return out;
}

/**
 * 저장된(또는 생성기가 만든) 문서를 다시 만든다. 이름을 바꾸고 참조 ID를 mapId로 바꾼다. 항목 ID와 나머지 필드는 그대로,
 * 없던 필드는 더하지 않는다(해시가 원본과 같게 유지되도록).
 */
export function rebuildDoc(raw: unknown, name: string, mapId: (id: string) => string): Doc {
  const doc: Doc = docSchema.parse(raw);
  const out: Doc = { schema: doc.schema, items: doc.items.map((it) => rebuildItem(it, mapId)) };
  if (doc.select !== undefined) {
    out.select = {};
    if (doc.select.count !== undefined) out.select.count = [doc.select.count[0], doc.select.count[1]];
    if (doc.select.sep !== undefined) out.select.sep = doc.select.sep;
  }
  out.name = name;
  if (doc.description !== undefined) out.description = doc.description;
  return out;
}
