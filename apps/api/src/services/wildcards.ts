// 와일드카드 생성, 새 버전, 삭제, 가져오기 (DESIGN 2절, 5절). 쓰기는 모두 트랜잭션 안에서 소유자를 잠그고 한다.

import { expand, isFixedDoc, type Doc } from "@wakaaka/core";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import { lockOwner } from "../repositories/owners.ts";
import * as repo from "../repositories/wildcards.ts";
import { latestBundle } from "./bundle.ts";
import { newWildcardId, rebuildDoc } from "./docs.ts";
import { docRefs, NAME_MAX, prepareDoc, storeContent, type Warning } from "./validate.ts";

export interface Owner {
  id: string;
  username: string;
}

/** 고정 분류 ID 상한 (DESIGN 3절, 14 성인 2026-11-12). 목록은 웹 apps/web/src/lib/categories.ts */
export const CATEGORY_MAX = 14;

/** 생성·저장 요청 본문. owner_id, forked_from, latest_seq 같은 필드는 받지 않는다(모르는 필드는 거부) */
export const saveBodySchema = z.strictObject({
  doc: z.unknown(),
  categories: z.array(z.int().min(1).max(CATEGORY_MAX)).max(CATEGORY_MAX).optional(),
});
export type SaveBody = z.infer<typeof saveBodySchema>;

const normCategories = (c: number[] | undefined) => (c === undefined ? undefined : [...new Set(c)].sort((a, b) => a - b));

export interface SaveResult {
  id: string;
  seq: number;
  hash: string;
  /** 최신 버전과 내용이 같아 새 버전을 만들지 않았다 */
  unchanged: boolean;
  warnings: Warning[];
}

/** 둘러보기 카드 예시 출력의 seed와 길이 (DESIGN 11절, NOTES Phase 3) */
export const EXAMPLE_SEED = "0";
export const EXAMPLE_MAX = 300;

/**
 * 예시 출력을 다시 계산한다. 이 와일드카드와 그것을 쓰는 내 와일드카드(조상)의 최신 묶음이 바뀌었으므로 모두 계산한다.
 * 전개가 실패하면(E_DEPTH, E_BUDGET 등) null. 저장 트랜잭션 안에서 부른다.
 */
async function refreshExamples(tx: Db, id: string): Promise<void> {
  const ids = [id, ...(await repo.dependents(tx, id)).map((d) => d.id)];
  for (const wid of ids) {
    const { bundle } = await latestBundle(tx, wid);
    const r = expand(bundle, EXAMPLE_SEED, { rootWildcard: wid });
    await repo.setExample(tx, wid, r.ok ? [...r.text].slice(0, EXAMPLE_MAX).join("") : null);
  }
}

/** 최신 버전을 따르는 와일드카드 행 값: 이름, 설명, 고정 표시(DESIGN 3절) */
const metaOf = (p: { name: string; doc: Doc }) => ({ name: p.name, description: p.doc.description ?? "", fixed: isFixedDoc(p.doc) });

function nameTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err.code === "23505" && err.constraint === "wildcard_owner_name_lower";
}

async function createIn(
  tx: Db,
  owner: Owner,
  raw: unknown,
  categories: number[] | undefined,
  forkedFrom: { wildcard: string; hash: string } | null,
  id = newWildcardId(),
): Promise<SaveResult> {
  const p = await prepareDoc(tx, owner.id, id, raw);
  await storeContent(tx, p);
  await repo.insertWildcard(tx, { id, ownerId: owner.id, ...metaOf(p), categories: categories ?? [], forkedFrom });
  const seq = await repo.appendVersion(tx, id, p.hash, metaOf(p), undefined);
  await refreshExamples(tx, id);
  return { id, seq, hash: p.hash, unchanged: false, warnings: p.warnings };
}

export async function createWildcard(db: Db, owner: Owner, body: SaveBody): Promise<SaveResult> {
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOwner(tx, owner.id);
      return createIn(tx, owner, body.doc, normCategories(body.categories), null);
    });
  } catch (e) {
    if (nameTaken(e)) throw new ApiError(409, "E_NAME_TAKEN", "you already have a wildcard with this name");
    throw e;
  }
}

/** 지운 것과 없는 것은 같은 404 */
async function liveWildcard(db: Db, id: string): Promise<repo.WildcardRow> {
  const w = await repo.getWildcard(db, id);
  if (!w || w.deleted_at !== null) throw new ApiError(404, "E_NOT_FOUND", "wildcard not found");
  return w;
}

async function ownedWildcard(db: Db, owner: Owner, id: string): Promise<repo.WildcardRow> {
  const w = await liveWildcard(db, id);
  if (w.owner_id !== owner.id) throw new ApiError(403, "E_FORBIDDEN", "not your wildcard");
  return w;
}

export async function saveVersion(db: Db, owner: Owner, id: string, body: SaveBody): Promise<SaveResult> {
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOwner(tx, owner.id);
      const w = await ownedWildcard(tx, owner, id);
      const p = await prepareDoc(tx, owner.id, id, body.doc);
      const categories = normCategories(body.categories);
      if (p.hash === w.hash) {
        if (categories) await repo.setCategories(tx, id, categories);
        return { id, seq: w.latest_seq, hash: w.hash, unchanged: true, warnings: p.warnings };
      }
      await storeContent(tx, p);
      const seq = await repo.appendVersion(tx, id, p.hash, metaOf(p), categories);
      await refreshExamples(tx, id);
      return { id, seq, hash: p.hash, unchanged: false, warnings: p.warnings };
    });
  } catch (e) {
    if (nameTaken(e)) throw new ApiError(409, "E_NAME_TAKEN", "you already have a wildcard with this name");
    throw e;
  }
}

/** 별칭 내리기. 내 와일드카드의 최신 버전이 참조하고 있으면 거부한다(DESIGN 2절 5항) */
export async function deleteWildcard(db: Db, owner: Owner, id: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockOwner(tx, owner.id);
    await ownedWildcard(tx, owner, id);
    const direct = (await repo.dependents(tx, id)).filter((d) => d.depth === 1);
    if (direct.length > 0) {
      throw new ApiError(409, "E_IN_USE", "other wildcards reference this one", { dependents: direct.map(({ id, name }) => ({ id, name })) });
    }
    await repo.markDeleted(tx, id);
  });
}

export function wildcardView(w: repo.WildcardRow) {
  return {
    id: w.id,
    name: w.name,
    owner: w.owner,
    version: w.latest_seq,
    hash: w.hash,
    categories: w.categories,
    likes: w.like_count,
    description: w.description,
    example: w.example,
    fixed: w.fixed,
    forkedFrom: w.forked_from_wildcard ? { wildcard: w.forked_from_wildcard, hash: w.forked_from_hash, owner: w.forked_from_owner } : null,
    createdAt: w.created_at.toISOString(),
    updatedAt: w.updated_at.toISOString(),
  };
}

export async function getWildcard(db: Db, id: string, seq?: number) {
  const w = await liveWildcard(db, id);
  const v = await repo.getVersion(db, id, seq ?? w.latest_seq);
  if (!v) throw new ApiError(404, "E_NOT_FOUND", "version not found");
  return { ...wildcardView(w), seq: v.seq, seqHash: v.hash, seqCreatedAt: v.created_at.toISOString(), doc: v.doc };
}

export async function listVersions(db: Db, id: string) {
  await liveWildcard(db, id);
  return (await repo.listVersions(db, id)).map((v) => ({ seq: v.seq, hash: v.hash, createdAt: v.created_at.toISOString() }));
}

export async function listDependents(db: Db, id: string) {
  await liveWildcard(db, id);
  return repo.dependents(db, id);
}

export async function listMine(db: Db, owner: Owner) {
  return (await repo.listOwned(db, owner.id)).map(wildcardView);
}

// ---------------------------------------------------------------- 가져오기 (DESIGN 2절)

export interface ImportResult {
  root: string;
  created: Array<{ id: string; name: string; forkedFrom: { wildcard: string; hash: string }; warnings: Warning[] }>;
  reused: Array<{ id: string; name: string; forkedFrom: string }>;
  dryRun: boolean;
}

/** 이름 충돌: " (원작자)"를 붙이고, 그래도 겹치면 " 2", " 3" …. 64자를 넘으면 원래 이름 쪽을 자른다 */
export function copyName(name: string, origin: string, taken: ReadonlySet<string>): string {
  const free = (n: string) => !taken.has(n.toLowerCase());
  if (free(name)) return name;
  const fit = (suffix: string) => {
    const cps = [...name];
    const keep = NAME_MAX - [...suffix].length;
    return (cps.length > keep ? cps.slice(0, keep).join("").replace(/[ \t\n\r]+$/, "") : name) + suffix;
  };
  for (let i = 1; ; i++) {
    const n = fit(i === 1 ? ` (${origin})` : ` (${origin}) ${i}`);
    if (free(n)) return n;
  }
}

class DryRun extends Error {
  readonly result: ImportResult;
  constructor(result: ImportResult) {
    super("dry run");
    this.result = result;
  }
}

/**
 * 남의 와일드카드를 그 시점 최신 버전으로 의존성까지 복사한다.
 * - 이미 같은 원본의 복사본(forked_from)이 있으면 그것을 쓰고 그 아래로는 내려가지 않는다.
 * - 복사본 안 참조는 복사본 ID로 바꾸고 항목 ID는 그대로 둔다. 그래서 같은 seed의 결과가 원본과 같다.
 * - 복사본마다 일반 저장과 같은 검증을 거친다. 하나라도 실패하면 전부 되돌린다.
 * dryRun이면 같은 일을 하고 되돌린 뒤 결과만 돌려준다(확인 창의 "N개 복사, M개 다시 씀").
 */
export async function importWildcard(db: Db, owner: Owner, sourceId: string, dryRun: boolean): Promise<ImportResult> {
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOwner(tx, owner.id);
      const src = await liveWildcard(tx, sourceId);
      if (src.owner_id === owner.id) throw new ApiError(400, "E_IMPORT_OWN", "this wildcard is already yours");

      const closure = new Map((await repo.latestClosure(tx, sourceId)).map((r) => [r.wildcard_id, r]));
      const copies = await repo.findCopies(tx, owner.id, [...closure.keys()]);
      const map = new Map<string, string>(); // 원본 ID → 내 ID
      const reused: ImportResult["reused"] = [];
      const order: string[] = []; // 복사할 것, 하위가 먼저
      const visited = new Set<string>();
      // 후위 순회. 원본 묶음은 저장할 때 순환 검사를 거쳤으므로 순환이 없다.
      const stack: Array<{ id: string; children: string[] | null }> = [{ id: sourceId, children: null }];
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        if (top.children === null) {
          if (visited.has(top.id)) {
            stack.pop();
            continue;
          }
          visited.add(top.id);
          const copy = copies.get(top.id);
          if (copy) {
            map.set(top.id, copy.id);
            reused.push({ id: copy.id, name: copy.name, forkedFrom: top.id });
            stack.pop();
            continue;
          }
          const row = closure.get(top.id);
          if (!row) throw new ApiError(500, "E_INTERNAL", "source closure is not complete");
          top.children = [...new Set(docRefs(row.doc).map((r) => r.target))];
          for (const t of top.children) if (!visited.has(t)) stack.push({ id: t, children: null });
          continue;
        }
        order.push(top.id);
        map.set(top.id, newWildcardId());
        stack.pop();
      }

      const taken = new Set((await repo.liveNames(tx, owner.id)).map((n) => n.toLowerCase()));
      const created: ImportResult["created"] = [];
      for (const sid of order) {
        const row = closure.get(sid)!;
        const name = copyName(row.doc.name ?? "", src.owner, taken);
        taken.add(name.toLowerCase());
        const doc = rebuildDoc(row.doc, name, (id) => {
          const m = map.get(id);
          if (!m) throw new ApiError(500, "E_INTERNAL", "unmapped reference in source");
          return m;
        });
        const forkedFrom = { wildcard: sid, hash: row.hash };
        const r = await createIn(tx, owner, doc, row.categories, forkedFrom, map.get(sid)!);
        created.push({ id: r.id, name, forkedFrom, warnings: r.warnings });
      }
      const result: ImportResult = { root: map.get(sourceId)!, created, reused, dryRun };
      if (dryRun) throw new DryRun(result);
      return result;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    if (nameTaken(e)) throw new ApiError(409, "E_NAME_TAKEN", "name collision while importing");
    throw e;
  }
}
