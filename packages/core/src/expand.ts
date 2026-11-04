// 전개기 (SPEC 4~6절). 묶음 + seed → 문자열과 출처 범위, 또는 오류 코드 하나.

import { cleanupWithMap } from "./cleanup.ts";
import { collectRefs, parse, type Node, type ParseError, type SyntaxErrorCode } from "./parser.ts";
import { bounded, derive, sampleWithoutReplacement, SplitMix64 } from "./random.ts";
import { expandDocSchema } from "./schema.ts";

export interface Limits {
  maxDepth: number;
  maxExpansions: number;
}
export const DEFAULT_LIMITS: Readonly<Limits> = { maxDepth: 16, maxExpansions: 10000 };

export type ExpandErrorCode =
  | "E_FORMAT"
  | "E_SEED"
  | "E_DOC"
  | SyntaxErrorCode
  | "E_UNRESOLVED"
  | "E_CYCLE"
  | "E_DEPTH"
  | "E_BUDGET";

export interface ExpandError {
  code: ExpandErrorCode;
  /** 오류가 난 문서의 해시 (아는 경우) */
  hash?: string;
  /** 오류가 난 항목 id (아는 경우) */
  item?: string;
  /** 문법 오류의 위치 (항목 텍스트 안의 UTF-16 오프셋) */
  syntax?: ParseError;
  /** 찾지 못한 와일드카드 ID 또는 해시 (E_UNRESOLVED) */
  missing?: string;
}

/** 결과 문자열 [start, end)가 어느 항목에서 왔는지. 위치는 쉼표 정리 후의 UTF-16 오프셋이다. */
export interface SourceRange {
  start: number;
  end: number;
  /** 항목이 든 문서의 해시 */
  hash: string;
  /** 그 문서의 와일드카드 ID. 루트는 options.rootWildcard(없으면 null) */
  wildcard: string | null;
  /** 항목 id */
  item: string;
}

export type ExpandResult = { ok: true; text: string; sources: SourceRange[] } | { ok: false; error: ExpandError };

/** 뽑기와 선택 기록. SPEC 4.3 성질 검사용이다. */
export type TraceEvent =
  | { type: "pick"; hash: string; keys: string[][] }
  | { type: "choice"; hash: string; item: string; n: number; alt: number };

export interface ExpandOptions {
  limits?: Partial<Limits>;
  rootWildcard?: string;
  trace?: (e: TraceEvent) => void;
}

interface TextItem {
  kind: "text";
  id: string;
  w: bigint;
  nodes: Node[];
}
interface RefItem {
  kind: "ref";
  id: string;
  w: bigint;
  spread: boolean;
  wildcard: string;
  target: string;
}
type Item = TextItem | RefItem;

interface Doc {
  hash: string;
  min: number;
  max: number;
  sep: string;
  items: Item[];
  /** 이 문서에서 나가는 간선(대상 해시). 중복 없음 */
  edges: string[];
}

interface Entry {
  item: Item;
  key: string[];
  w: bigint;
  doc: Doc;
  wildcard: string | null;
}

class Fail extends Error {
  readonly error: ExpandError;
  constructor(error: ExpandError) {
    super(error.code);
    this.error = error;
  }
}

const SEED_MAX = (1n << 64n) - 1n;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseSeed(seed: bigint | string): bigint | null {
  if (typeof seed === "string") {
    if (!/^[0-9]+$/.test(seed)) return null;
    seed = BigInt(seed);
  }
  return seed >= 0n && seed <= SEED_MAX ? seed : null;
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}

export function expand(bundle: unknown, seed: bigint | string, options: ExpandOptions = {}): ExpandResult {
  try {
    return expandOrThrow(bundle, seed, options);
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.error };
    throw e;
  }
}

function expandOrThrow(bundle: unknown, seedIn: bigint | string, options: ExpandOptions): ExpandResult {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };

  // 4.1 사전 검사 1: format, 묶음 모양, seed
  if (!isPlainObject(bundle) || bundle.format !== 1) throw new Fail({ code: "E_FORMAT" });
  const { root, lock, docs } = bundle;
  if (typeof root !== "string" || !isPlainObject(lock) || !isPlainObject(docs)) throw new Fail({ code: "E_FORMAT" });
  const seed = parseSeed(seedIn);
  if (seed === null) throw new Fail({ code: "E_SEED" });

  // 2: 루트
  if (!Object.hasOwn(docs, root)) throw new Fail({ code: "E_UNRESOLVED", missing: root });

  const resolve = (wildcard: string, hash: string, item: string): string => {
    const target = Object.hasOwn(lock, wildcard) ? lock[wildcard] : undefined;
    if (typeof target !== "string" || !Object.hasOwn(docs, target)) throw new Fail({ code: "E_UNRESOLVED", hash, item, missing: wildcard });
    return target;
  };

  // 3: 루트에서 닿는 문서의 스키마, 문법, 참조 해결
  const prepared = new Map<string, Doc>();
  const queue = [root];
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (prepared.has(hash)) continue;
    const doc = prepareDoc(hash, docs[hash], resolve);
    prepared.set(hash, doc);
    for (const t of doc.edges) if (!prepared.has(t)) queue.push(t);
  }

  // 4, 5: 순환과 깊이 (가장 긴 간선 경로)
  if (longestPath(root, prepared) > limits.maxDepth) throw new Fail({ code: "E_DEPTH" });

  // 4.2 절차
  const sources: SourceRange[] = [];
  let used = 0;
  const spend = () => {
    if (++used > limits.maxExpansions) throw new Fail({ code: "E_BUDGET" });
  };
  const docOf = (hash: string) => prepared.get(hash)!;

  const pool = (d: Doc, wildcard: string | null, prefix: string[], out: Entry[]): Entry[] => {
    for (const it of d.items) {
      if (it.kind === "ref" && it.spread) {
        spend();
        pool(docOf(it.target), it.wildcard, [...prefix, it.id], out);
      } else {
        out.push({ item: it, key: [...prefix, it.id], w: it.w, doc: d, wildcard });
      }
    }
    return out;
  };

  const expandDoc = (d: Doc, wildcard: string | null, c: bigint, base: number): string => {
    spend();
    const entries = pool(d, wildcard, [], []);
    const rng = new SplitMix64(derive(c, "select"));
    const k = d.min + Number(bounded(rng, BigInt(d.max - d.min + 1)));
    const cands = entries.filter((e) => e.w > 0n).sort((a, b) => compareKeys(a.key, b.key));
    const picks = sampleWithoutReplacement(
      rng,
      cands.map((e) => e.w),
      k,
    );
    options.trace?.({ type: "pick", hash: d.hash, keys: picks.map((i) => cands[i]!.key) });
    let out = "";
    for (const idx of picks) {
      const e = cands[idx]!;
      let t = c;
      for (const id of e.key) t = derive(t, "item:" + id);
      // 결과가 비지 않으면 그 앞에 sep이 붙는다. 비면 길이 0인 범위라 나중에 버린다.
      const start = base + out.length + (out === "" ? 0 : d.sep.length);
      const span: SourceRange = { start, end: start, hash: e.doc.hash, wildcard: e.wildcard, item: e.item.id };
      sources.push(span);
      const s = expandItem(e.item, e.doc, t, start);
      span.end = start + s.length;
      if (s !== "") out += (out === "" ? "" : d.sep) + s;
    }
    return out;
  };

  const expandItem = (it: Item, owner: Doc, t: bigint, base: number): string => {
    if (it.kind === "ref") return expandDoc(docOf(it.target), it.wildcard, derive(t, "pos:0"), base);
    return render(it.nodes, owner, it.id, t, base);
  };

  const render = (nodes: readonly Node[], owner: Doc, itemId: string, t: bigint, base: number): string => {
    let out = "";
    for (const nd of nodes) {
      if (nd.type === "text") {
        out += nd.value;
      } else if (nd.type === "ref") {
        // 사전 검사에서 저장 형태만 통과했으므로 kind는 "w"이고 lock으로 풀린다.
        if (nd.kind !== "w") throw new Error("unreachable: name ref in stored text");
        out += expandDoc(docOf(lock[nd.id] as string), nd.id, derive(t, "pos:" + nd.n), base + out.length);
      } else {
        // SPEC 4.2 선택지 뽑기: 보기 가중치로 6.4절 추출 1번. 안 적은 보기는 1이라 모두 1이면 bounded(보기 수)와 같다
        const a = sampleWithoutReplacement(new SplitMix64(derive(t, "pos:" + nd.n)), nd.weights.map(BigInt), 1)[0]!;
        options.trace?.({ type: "choice", hash: owner.hash, item: itemId, n: nd.n, alt: a });
        out += render(nd.alts[a]!, owner, itemId, t, base + out.length);
      }
    }
    return out;
  };

  const raw = expandDoc(docOf(root), options.rootWildcard ?? null, seed, 0);

  // 4.4 쉼표 정리. 출처 범위를 지워진 글자만큼 옮기고, 길이가 0이 된 범위는 버린다.
  const cleaned = cleanupWithMap(raw);
  const moved: SourceRange[] = [];
  for (const s of sources) {
    const start = cleaned.map(s.start);
    const end = cleaned.map(s.end);
    if (end > start) moved.push({ ...s, start, end });
  }
  return { ok: true, text: cleaned.text, sources: moved };
}

function prepareDoc(hash: string, raw: unknown, resolve: (wildcard: string, hash: string, item: string) => string): Doc {
  const r = expandDocSchema.safeParse(raw);
  if (!r.success) throw new Fail({ code: "E_DOC", hash });
  const d = r.data;
  const edges = new Set<string>();
  const items: Item[] = d.items.map((it): Item => {
    const w = BigInt(it.w ?? 1);
    if (it.ref !== undefined) {
      const target = resolve(it.ref.wildcard, hash, it.id);
      edges.add(target);
      return { kind: "ref", id: it.id, w, spread: it.spread ?? false, wildcard: it.ref.wildcard, target };
    }
    const p = parse(it.text!, "stored");
    if (!p.ok) throw new Fail({ code: p.error.code, hash, item: it.id, syntax: p.error });
    for (const ref of collectRefs(p.nodes)) {
      if (ref.kind === "w") edges.add(resolve(ref.id, hash, it.id));
    }
    return { kind: "text", id: it.id, w, nodes: p.nodes };
  });
  const [min, max] = d.select?.count ?? [1, 1];
  return { hash, min, max, sep: d.select?.sep ?? ", ", items, edges: [...edges] };
}

/** 루트에서 시작하는 가장 긴 간선 경로의 길이. 순환이 있으면 E_CYCLE. 재귀 없이 돈다. */
function longestPath(root: string, docs: ReadonlyMap<string, Doc>): number {
  const state = new Map<string, 1 | 2>(); // 1: 방문 중, 2: 끝남
  const depth = new Map<string, number>();
  const stack: Array<{ hash: string; i: number }> = [{ hash: root, i: 0 }];
  state.set(root, 1);
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const edges = docs.get(top.hash)!.edges;
    if (top.i < edges.length) {
      const t = edges[top.i++]!;
      const st = state.get(t);
      if (st === 1) throw new Fail({ code: "E_CYCLE", hash: t });
      if (st === undefined) {
        state.set(t, 1);
        stack.push({ hash: t, i: 0 });
      }
      continue;
    }
    let d = 0;
    for (const t of edges) d = Math.max(d, depth.get(t)! + 1);
    depth.set(top.hash, d);
    state.set(top.hash, 2);
    stack.pop();
  }
  return depth.get(root)!;
}
