// 미리보기 (DESIGN 11절 오른쪽 패널): 저장하지 않은 문서를 브라우저에서 core expand로 전개한다.
// 하위 와일드카드는 /api/w/{id}/bundle(닫힌 최신 묶음)을 받아 합친다. 편집 중인 문서는 해시를 계산하지 않고(core/hash는
// node:crypto라 웹에 넣지 않는다) 고정 키 DRAFT_KEY로 넣는다. 전개기는 docs 키와 내용의 해시를 검증하지 않는다(SPEC 3.2).

import { collectRefs, expand, parse, type Doc, type ExpandResult, type SourceRange } from "@wakaaka/core";

export const DRAFT_KEY = "DRAFTpreview";
export const PREVIEW_COUNT = 5;
const SEED_MAX = (1n << 64n) - 1n;

export interface BundleLike {
  format: 1;
  root: string;
  lock: Record<string, string>;
  docs: Record<string, Doc>;
}

/** 문서가 직접 참조하는 와일드카드 ID (ref 항목, 텍스트 안 `${w:}`), 처음 나온 순서 */
export function directRefs(doc: Doc): string[] {
  const out: string[] = [];
  const add = (id: string) => out.includes(id) || out.push(id);
  for (const it of doc.items) {
    if (it.ref !== undefined) add(it.ref.wildcard);
    else if (it.text !== undefined) {
      const p = parse(it.text, "stored");
      if (p.ok) for (const r of collectRefs(p.nodes)) if (r.kind === "w") add(r.id);
    }
  }
  return out;
}

/**
 * 편집 중인 문서 + 하위 묶음들 → 전개할 묶음. selfId가 있으면 lock[selfId] = DRAFT_KEY로 둬서
 * 자기 자신을 참조하면 E_UNRESOLVED가 아니라 E_CYCLE이 나오게 한다.
 */
export function buildPreviewBundle(doc: Doc, deps: Iterable<BundleLike>, selfId?: string): BundleLike {
  const lock: Record<string, string> = {};
  const docs: Record<string, Doc> = {};
  for (const b of deps) {
    for (const [id, h] of Object.entries(b.lock)) lock[id] = h;
    for (const [h, d] of Object.entries(b.docs)) docs[h] = d;
  }
  if (selfId !== undefined) lock[selfId] = DRAFT_KEY;
  docs[DRAFT_KEY] = doc;
  return { format: 1, root: DRAFT_KEY, lock, docs };
}

/** seed 문자열 검증: 0 ≤ seed < 2^64 의 10진수 */
export function parseSeed(s: string): bigint | null {
  if (!/^[0-9]{1,20}$/.test(s)) return null;
  const v = BigInt(s);
  return v <= SEED_MAX ? v : null;
}

/** seed부터 하나씩 늘린 PREVIEW_COUNT개. 2^64−1을 넘으면 0으로 돌아간다 */
export function previewSeeds(seed: bigint): bigint[] {
  return Array.from({ length: PREVIEW_COUNT }, (_, i) => (seed + BigInt(i)) & SEED_MAX);
}

export function expandPreview(bundle: BundleLike, seeds: bigint[], rootWildcard?: string): Array<{ seed: bigint; result: ExpandResult }> {
  return seeds.map((seed) => ({ seed, result: expand(bundle, seed, rootWildcard ? { rootWildcard } : {}) }));
}

export interface Segment {
  start: number;
  end: number;
  /** 이 조각을 덮는 가장 안쪽 범위의 번호(sources 안), 없으면 -1 */
  source: number;
}

/**
 * 결과 문자열을 출처 경계로 나눈다. 범위는 겹쳐 있고 바깥 것이 먼저다(SPEC 4.5).
 * 각 조각의 출처는 그 조각을 덮는 가장 안쪽(목록에서 가장 뒤의) 범위다.
 */
export function segments(text: string, sources: readonly SourceRange[]): Segment[] {
  const cuts = new Set([0, text.length]);
  for (const s of sources) cuts.add(s.start), cuts.add(s.end);
  const xs = [...cuts].filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const start = xs[k]!;
    const end = xs[k + 1]!;
    let source = -1;
    for (let i = 0; i < sources.length; i++) if (sources[i]!.start <= start && end <= sources[i]!.end) source = i;
    out.push({ start, end, source });
  }
  return out;
}

export interface TreeNode {
  id: string;
  name: string;
  /** 같은 와일드카드가 위에서 이미 나왔다(DESIGN 11절 "↑ 위에 있음") */
  seen: boolean;
  missing: boolean;
  children: TreeNode[];
}

/** 의존 트리: 편집 중인 문서에서 시작해 묶음의 lock으로 내려간다. 두 번째로 나오는 것은 펼치지 않는다 */
export function dependencyTree(bundle: BundleLike): TreeNode[] {
  const seen = new Set<string>();
  const nodeOf = (id: string, depth: number): TreeNode => {
    const h = Object.hasOwn(bundle.lock, id) ? bundle.lock[id]! : undefined;
    const d = h !== undefined && Object.hasOwn(bundle.docs, h) ? bundle.docs[h]! : undefined;
    const node: TreeNode = { id, name: d?.name ?? id, seen: seen.has(id), missing: d === undefined, children: [] };
    if (node.seen || !d || depth > 32 || h === DRAFT_KEY) return node;
    seen.add(id);
    node.children = directRefs(d).map((c) => nodeOf(c, depth + 1));
    return node;
  };
  const root = bundle.docs[bundle.root];
  return root ? directRefs(root).map((id) => nodeOf(id, 1)) : [];
}
