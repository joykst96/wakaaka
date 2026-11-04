// 저장 검증 (DESIGN 5절, 9절 "입력과 저장"). 순서:
//   docSchema → 이름 → 문법 → 참조(내 와일드카드만) → 순환 → 가중치 합 0 → 정규화(JCS)와 크기
//   → 깊이·묶음 크기와 영향 분석(경고) → 내용 해시
// 본문 크기 제한, JSON.parse, 중복 키는 http.ts의 readJson이 먼저 한다. 저장(storeContent)은 바이트 비교로 해시 충돌을 막는다.

import { collectRefs, docSchema, parse, trimSpecWhitespace, type Doc } from "@wakaaka/core";
import { base62of256, canonicalize, sha256 } from "@wakaaka/core/hash";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import * as repo from "../repositories/wildcards.ts";

export const MAX_DOC_BYTES = 256 * 1024;
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
export const MAX_DEPTH = 16;
export const NAME_MAX = 64;

export interface Warning {
  code: "W_DEPTH" | "W_BUNDLE_SIZE" | "W_WEIGHT_ZERO";
  /** 문제가 생기는 와일드카드. 저장하는 것 자신이거나 그것을 쓰는 내 와일드카드 */
  wildcard: string;
  depth?: number;
  bytes?: number;
}

export interface Prepared {
  doc: Doc;
  name: string;
  canonical: string;
  size: number;
  hash: string;
  refs: Array<{ item: string; target: string }>;
  warnings: Warning[];
}

/** 이름 규칙 (DESIGN 3절): 필수, 코드 포인트 1~64자, 앞뒤 공백 거부. 금지 글자와 공백뿐인 이름은 docSchema가 막는다 */
export function checkName(name: string | undefined): string {
  if (name === undefined) throw new ApiError(400, "E_NAME", "name is required");
  if (trimSpecWhitespace(name) !== name) throw new ApiError(400, "E_NAME", "name must not start or end with whitespace");
  if ([...name].length > NAME_MAX) throw new ApiError(400, "E_NAME", `name must be at most ${NAME_MAX} characters`);
  return name;
}

/** 문서의 참조 (항목 ID, 대상). 문법 오류가 있으면 E_SYNTAX */
export function docRefs(doc: Doc): Array<{ item: string; target: string }> {
  const out: Array<{ item: string; target: string }> = [];
  const seen = new Set<string>();
  const add = (item: string, target: string) => {
    const k = item + ":" + target;
    if (!seen.has(k)) out.push({ item, target });
    seen.add(k);
  };
  for (const it of doc.items) {
    if (it.ref !== undefined) {
      add(it.id, it.ref.wildcard);
      continue;
    }
    const p = parse(it.text!, "stored");
    if (!p.ok) throw new ApiError(400, "E_SYNTAX", `syntax error in item ${it.id}`, { item: it.id, syntax: p.error });
    for (const r of collectRefs(p.nodes)) if (r.kind === "w") add(it.id, r.id);
  }
  return out;
}

export function contentHashOf(canonical: string): string {
  return base62of256(sha256(canonical)).slice(0, 12);
}

type Graph = Map<string, Set<string>>;

function addEdge(g: Graph, a: string, b: string) {
  let s = g.get(a);
  if (!s) g.set(a, (s = new Set()));
  s.add(b);
}

/** self에서 출발해 self로 돌아오는 경로 (없으면 null) */
function findCycle(g: Graph, self: string): string[] | null {
  const parent = new Map<string, string>();
  const queue = [...(g.get(self) ?? [])];
  for (const t of queue) parent.set(t, self);
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n === self) {
      const path = [self];
      for (let x = parent.get(self)!; x !== self; x = parent.get(x)!) path.push(x);
      path.push(self);
      return path.reverse();
    }
    for (const t of g.get(n) ?? []) {
      if (!parent.has(t)) {
        parent.set(t, n);
        queue.push(t);
      }
    }
  }
  return null;
}

/** 순환이 없는 그래프에서 각 노드의 가장 긴 간선 경로 (재귀 없이) */
function longestPaths(g: Graph): Map<string, number> {
  const memo = new Map<string, number>();
  for (const start of g.keys()) {
    if (memo.has(start)) continue;
    const stack: Array<{ n: string; i: number; edges: string[] }> = [{ n: start, i: 0, edges: [...(g.get(start) ?? [])] }];
    const onStack = new Set([start]);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.i < top.edges.length) {
        const t = top.edges[top.i++]!;
        if (!memo.has(t) && !onStack.has(t)) {
          onStack.add(t);
          stack.push({ n: t, i: 0, edges: [...(g.get(t) ?? [])] });
        }
        continue;
      }
      let d = 0;
      for (const t of top.edges) d = Math.max(d, (memo.get(t) ?? 0) + 1);
      memo.set(top.n, d);
      onStack.delete(top.n);
      stack.pop();
    }
  }
  return memo;
}

function reachable(g: Graph, from: string): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    for (const t of g.get(queue.shift()!) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      queue.push(t);
    }
  }
  return seen;
}

/**
 * spread를 펼친 후보 수와 가중치 합 (SPEC 4.2 pool). 문서는 getDoc으로 얻는다(없는 대상은 0개로 친다).
 * spread 대상은 순환 검사를 통과한 뒤에만 부르므로 끝난다.
 */
function poolStats(id: string, getDoc: (id: string) => Doc | undefined, memo: Map<string, { n: number; sum: number }>) {
  const hit = memo.get(id);
  if (hit) return hit;
  const r = { n: 0, sum: 0 };
  for (const it of getDoc(id)?.items ?? []) {
    if (it.ref !== undefined && it.spread === true) {
      const s = poolStats(it.ref.wildcard, getDoc, memo);
      r.n += s.n;
      r.sum += s.sum;
    } else {
      r.n += 1;
      r.sum += it.w ?? 1;
    }
  }
  memo.set(id, r);
  return r;
}

const spreadTargets = (doc: Doc) => doc.items.flatMap((it) => (it.ref !== undefined && it.spread === true ? [it.ref.wildcard] : []));

/**
 * 받은 문서(JSON.parse 결과)를 검증해 저장할 형태로 만든다. 거부할 문제는 ApiError를 던진다.
 * selfId는 저장할 와일드카드 ID(새로 만들 때도 미리 정한다), ownerId는 세션의 소유자다.
 * 트랜잭션 안에서 소유자를 잠근 뒤에 부른다.
 */
export async function prepareDoc(db: Db, ownerId: string, selfId: string, raw: unknown): Promise<Prepared> {
  // 1. 엄격 스키마 (모르는 필드, 타입·범위, 문자열 검사, __proto__)
  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String), message: i.message }));
    throw new ApiError(400, "E_SCHEMA", "document does not match the schema", { issues });
  }
  const doc: Doc = parsed.data;
  const name = checkName(doc.name);

  // 2. 문법, 3. 참조 대상은 내 지우지 않은 와일드카드
  const refs = docRefs(doc);
  const targets = [...new Set(refs.map((r) => r.target))];
  const live = await repo.liveOwnedIds(db, ownerId, targets);
  const missing = refs.find((r) => !live.has(r.target));
  if (missing) {
    throw new ApiError(400, "E_REF_NOT_FOUND", "reference must be one of your wildcards", { item: missing.item, wildcard: missing.target });
  }

  // 4. 순환: 내 와일드카드 최신 버전의 간선 전체에서 self의 간선만 새 것으로 바꾼다
  const graph: Graph = new Map();
  for (const e of await repo.ownerEdges(db, ownerId)) if (e.src !== selfId) addEdge(graph, e.src, e.target);
  graph.set(selfId, new Set(targets));
  const cycle = findCycle(graph, selfId);
  if (cycle) throw new ApiError(400, "E_CYCLE", "reference cycle", { path: cycle });

  // 5. 가중치 합 0 (spread를 펼친 후보). 영향 분석에 쓸 조상 문서도 같이 읽는다
  const reverse: Graph = new Map();
  for (const [a, ts] of graph) for (const b of ts) addEdge(reverse, b, a);
  const ancestors = [...reachable(reverse, selfId)].filter((x) => x !== selfId);
  const docs = new Map<string, Doc>([[selfId, doc]]);
  let frontier = [...ancestors, ...spreadTargets(doc)];
  while (frontier.length > 0) {
    const want = frontier.filter((x) => !docs.has(x));
    const loaded = await repo.latestDocs(db, want);
    for (const [id, v] of loaded) docs.set(id, v.doc);
    frontier = [...loaded.values()].flatMap((v) => spreadTargets(v.doc)).filter((x) => !docs.has(x));
  }
  const memo = new Map<string, { n: number; sum: number }>();
  const self = poolStats(selfId, (id) => docs.get(id), memo);
  if (self.n > 0 && self.sum === 0) throw new ApiError(400, "E_WEIGHT_ZERO", "the total weight of candidates is 0");

  // 6. 정규화와 문서 크기
  const canonical = canonicalize(doc);
  const size = Buffer.byteLength(canonical, "utf8");
  if (size > MAX_DOC_BYTES) throw new ApiError(413, "E_TOO_LARGE", `document is larger than ${MAX_DOC_BYTES} bytes`, { bytes: size });

  // 7. 경고: 깊이, 묶음 크기, 조상의 가중치 합 0 (DESIGN 5절 4~5단계)
  const warnings: Warning[] = [];
  const depth = longestPaths(graph);
  const sizes = await repo.ownerSizes(db, ownerId);
  sizes.set(selfId, size);
  for (const w of [selfId, ...ancestors]) {
    const d = depth.get(w) ?? 0;
    if (d > MAX_DEPTH) warnings.push({ code: "W_DEPTH", wildcard: w, depth: d });
    let bytes = 0;
    for (const x of reachable(graph, w)) bytes += sizes.get(x) ?? 0;
    if (bytes > MAX_BUNDLE_BYTES) warnings.push({ code: "W_BUNDLE_SIZE", wildcard: w, bytes });
    if (w !== selfId) {
      const s = poolStats(w, (id) => docs.get(id), memo);
      if (s.n > 0 && s.sum === 0) warnings.push({ code: "W_WEIGHT_ZERO", wildcard: w });
    }
  }

  // 8. 내용 해시는 서버가 정규화 결과로 계산한다
  return { doc, name, canonical, size, hash: contentHashOf(canonical), refs, warnings };
}

/**
 * 내용과 참조를 저장한다. 같은 해시가 이미 있으면 저장된 문서를 다시 정규화해 바이트 비교하고, 다르면 거부한다(DESIGN 9절 5항).
 */
export async function storeContent(db: Db, p: Prepared): Promise<void> {
  const r = await repo.insertContent(db, p.hash, p.canonical, p.size);
  if (!r.inserted && canonicalize(r.doc) !== p.canonical) {
    console.error(JSON.stringify({ event: "hash_collision", hash: p.hash, at: new Date().toISOString() }));
    throw new ApiError(409, "E_HASH_COLLISION", "content hash collision; the document was not saved", { hash: p.hash });
  }
  await repo.insertRefs(db, p.hash, p.refs);
}
