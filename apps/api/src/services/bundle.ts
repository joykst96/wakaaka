// 노드용 묶음과 resolve (DESIGN 7절 "묶음 형식"). lock에는 루트도 들어간다.

import { expand, toImpactPrompt, type Doc } from "@wakaaka/core";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import * as repo from "../repositories/wildcards.ts";
import { docRefs } from "./validate.ts";

export interface Bundle {
  format: 1;
  root: string;
  lock: Record<string, string>;
  docs: Record<string, Doc>;
}

export const MAX_LOCK_ENTRIES = 2000;
const LOCK_PARAM = /^[0-9A-Za-z]{12}:[0-9A-Za-z]{12}(,[0-9A-Za-z]{12}:[0-9A-Za-z]{12})*$/;
const SEED = /^[0-9]{1,20}$/;
const SEED_MAX = (1n << 64n) - 1n;

/** lock 쿼리 "ID:해시,ID:해시" (ID 순) */
export function formatLock(lock: Record<string, string>): string {
  return Object.keys(lock)
    .sort()
    .map((id) => `${id}:${lock[id]}`)
    .join(",");
}

export function parseLock(s: string): Map<string, string> {
  if (!LOCK_PARAM.test(s)) throw new ApiError(400, "E_LOCK", "lock must be ID:hash pairs joined by commas");
  const out = new Map<string, string>();
  for (const pair of s.split(",")) {
    const [id, hash] = pair.split(":") as [string, string];
    if (out.has(id)) throw new ApiError(400, "E_LOCK", "duplicate wildcard in lock", { wildcard: id });
    out.set(id, hash);
  }
  if (out.size > MAX_LOCK_ENTRIES) throw new ApiError(400, "E_LOCK", `lock has more than ${MAX_LOCK_ENTRIES} entries`);
  return out;
}

export function parseSeed(s: string | undefined): string {
  if (s === undefined || !SEED.test(s) || BigInt(s) > SEED_MAX) throw new ApiError(400, "E_SEED", "seed must be a decimal integer in 0..2^64-1");
  return BigInt(s).toString(); // 앞의 0을 뗀다
}

/** 응답 전 확인: 루트와 lock 값이 docs에 있고, 모든 문서의 참조가 lock과 docs로 풀린다 */
export function assertClosed(b: Bundle): void {
  const fail = (what: string) => {
    console.error(JSON.stringify({ event: "bundle_not_closed", root: b.root, what }));
    throw new ApiError(500, "E_INTERNAL", "bundle is not closed");
  };
  if (!Object.hasOwn(b.docs, b.root)) fail("root");
  for (const h of Object.values(b.lock)) if (!Object.hasOwn(b.docs, h)) fail(`lock value ${h}`);
  for (const [h, doc] of Object.entries(b.docs)) {
    for (const r of docRefs(doc)) {
      const t = Object.hasOwn(b.lock, r.target) ? b.lock[r.target] : undefined;
      if (t === undefined || !Object.hasOwn(b.docs, t)) fail(`${h}/${r.item} -> ${r.target}`);
    }
  }
}

function sortedRecord<T>(entries: Iterable<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}

export async function liveRoot(db: Db, id: string): Promise<repo.WildcardRow> {
  const w = await repo.getWildcard(db, id);
  if (!w || w.deleted_at !== null) throw new ApiError(404, "E_NOT_FOUND", "wildcard not found");
  return w;
}

/** 최신 버전으로 만든 닫힌 묶음 */
export async function latestBundle(db: Db, id: string): Promise<{ wildcard: repo.WildcardRow; bundle: Bundle }> {
  const wildcard = await liveRoot(db, id);
  const rows = await repo.latestClosure(db, id);
  const root = rows.find((r) => r.wildcard_id === id);
  if (!root) throw new ApiError(500, "E_INTERNAL", "root version missing");
  const bundle: Bundle = {
    format: 1,
    root: root.hash,
    lock: sortedRecord(rows.map((r) => [r.wildcard_id, r.hash])),
    docs: sortedRecord(rows.map((r) => [r.hash, r.doc])),
  };
  assertClosed(bundle);
  return { wildcard, bundle };
}

/**
 * 받은 lock으로 만든 닫힌 묶음. 각 쌍은 루트 소유자 와일드카드의 실제 버전이어야 한다.
 * 루트에서 닿는 참조가 lock에 없으면 최신으로 채우지 않고 오류. 닿는 와일드카드가 지워졌으면 404. 닿지 않는 항목은 무시한다.
 */
export async function lockedBundle(db: Db, id: string, lock: ReadonlyMap<string, string>): Promise<{ wildcard: repo.WildcardRow; bundle: Bundle }> {
  const wildcard = await liveRoot(db, id);
  const rootHash = lock.get(id);
  if (rootHash === undefined) throw new ApiError(400, "E_LOCK", "lock must include the root wildcard", { wildcard: id });
  const found = new Map((await repo.versionPairs(db, [...lock])).map((r) => [r.wildcard_id, r]));
  for (const wid of lock.keys()) {
    const f = found.get(wid);
    if (!f || f.owner_id !== wildcard.owner_id) throw new ApiError(400, "E_LOCK_INVALID", "lock entry is not a version of this owner's wildcard", { wildcard: wid });
  }
  const docs = await repo.contentDocs(db, [...new Set(lock.values())]);
  const reached = new Map<string, string>([[id, rootHash]]);
  const queue = [id];
  while (queue.length > 0) {
    const wid = queue.shift()!;
    if (found.get(wid)!.deleted) throw new ApiError(404, "E_NOT_FOUND", "a wildcard in the lock was deleted", { wildcard: wid });
    for (const r of docRefs(docs.get(lock.get(wid)!)!)) {
      if (reached.has(r.target)) continue;
      const h = lock.get(r.target);
      if (h === undefined) throw new ApiError(400, "E_LOCK_INCOMPLETE", "lock does not cover a referenced wildcard", { missing: r.target });
      reached.set(r.target, h);
      queue.push(r.target);
    }
  }
  const bundle: Bundle = {
    format: 1,
    root: rootHash,
    lock: sortedRecord(reached),
    docs: sortedRecord([...new Set(reached.values())].map((h) => [h, docs.get(h)!])),
  };
  assertClosed(bundle);
  return { wildcard, bundle };
}

/** /api/w/{id}/export 쿼리. 형식은 enum으로만 받는다 */
export const exportQuerySchema = z.strictObject({ format: z.enum(["impact"]) });

/** 최신 묶음을 Impact Pack 와일드카드 노드용 프롬프트 한 줄로 (DESIGN 11절 "Impact Pack 내보내기") */
export async function exportPrompt(db: Db, id: string, query: Record<string, string>) {
  const q = exportQuerySchema.safeParse(query);
  if (!q.success) throw new ApiError(400, "E_QUERY", "format must be impact");
  const { bundle } = await latestBundle(db, id);
  const r = toImpactPrompt(bundle, { rootWildcard: id });
  if (!r.ok) throw new ApiError(422, "E_EXPAND", "cannot convert", { expand: { code: r.error.code, wildcard: r.error.missing } });
  return { format: q.data.format, text: r.text, warnings: r.warnings };
}

export async function resolve(db: Db, id: string, seedParam: string | undefined, lockParam: string | undefined) {
  const seed = parseSeed(seedParam);
  const { bundle } = lockParam === undefined ? await latestBundle(db, id) : await lockedBundle(db, id, parseLock(lockParam));
  const r = expand(bundle, seed, { rootWildcard: id });
  if (!r.ok) throw new ApiError(422, "E_EXPAND", "expansion failed", { expand: { code: r.error.code, wildcard: r.error.missing } });
  return { text: r.text, seed, root: bundle.root, lock: bundle.lock };
}
