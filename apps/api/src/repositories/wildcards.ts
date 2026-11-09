// 와일드카드, 버전, 내용, 참조 SQL. 모든 값은 파라미터로 바인딩한다(DESIGN 9절 3항).
// 재귀 CTE는 sql 템플릿으로 쓰지만 사용자 값은 ${}(바인딩)로만 넣는다. sql.raw/lit/ref는 쓰지 않는다.

import { sql } from "kysely";
import type { Doc } from "@wakaaka/core";
import type { Db } from "../db/connect.ts";

export interface WildcardRow {
  id: string;
  owner_id: string;
  owner: string;
  name: string;
  latest_seq: number;
  hash: string;
  categories: number[];
  like_count: number;
  forked_from_wildcard: string | null;
  forked_from_hash: string | null;
  /** 원본 와일드카드의 소유자 아이디 (원본이 지워졌어도 남는다) */
  forked_from_owner: string | null;
  description: string;
  example: string | null;
  /** 최신 버전이 고정인지 (DESIGN 3절 "고정 표시") */
  fixed: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function wildcardQuery(db: Db) {
  return db
    .selectFrom("wildcard as w")
    .innerJoin("owner as o", "o.id", "w.owner_id")
    .innerJoin("wc_version as v", (j) => j.onRef("v.wildcard_id", "=", "w.id").onRef("v.seq", "=", "w.latest_seq"))
    .leftJoin("wildcard as fw", "fw.id", "w.forked_from_wildcard")
    .leftJoin("owner as fo", "fo.id", "fw.owner_id")
    .select([
      "w.id",
      "w.owner_id",
      "o.username as owner",
      "w.name",
      "w.latest_seq",
      "v.hash",
      "w.categories",
      "w.like_count",
      "w.forked_from_wildcard",
      "w.forked_from_hash",
      "fo.username as forked_from_owner",
      "w.description",
      "w.example",
      "w.fixed",
      "w.created_at",
      "v.created_at as updated_at",
      "w.deleted_at",
    ]);
}

/** 지운 것도 돌려준다. 부르는 쪽이 deleted_at을 본다. */
export async function getWildcard(db: Db, id: string): Promise<WildcardRow | undefined> {
  return wildcardQuery(db).where("w.id", "=", id).executeTakeFirst();
}

export async function listOwned(db: Db, ownerId: string): Promise<WildcardRow[]> {
  return wildcardQuery(db).where("w.owner_id", "=", ownerId).where("w.deleted_at", "is", null).orderBy("w.name").execute();
}

export async function getVersion(db: Db, id: string, seq: number) {
  return db
    .selectFrom("wc_version as v")
    .innerJoin("wc_content as c", "c.hash", "v.hash")
    .select(["v.seq", "v.hash", "v.created_at", "c.doc"])
    .where("v.wildcard_id", "=", id)
    .where("v.seq", "=", seq)
    .executeTakeFirst();
}

export async function listVersions(db: Db, id: string) {
  return db.selectFrom("wc_version").select(["seq", "hash", "created_at"]).where("wildcard_id", "=", id).orderBy("seq", "desc").execute();
}

/** ids 중 ownerId의 지우지 않은 와일드카드 */
export async function liveOwnedIds(db: Db, ownerId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom("wildcard")
    .select("id")
    .where("owner_id", "=", ownerId)
    .where("deleted_at", "is", null)
    .where("id", "in", [...ids])
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** ownerId의 지우지 않은 와일드카드 최신 버전들의 참조 간선 (src → target, 중복 없음) */
export async function ownerEdges(db: Db, ownerId: string): Promise<Array<{ src: string; target: string }>> {
  return db
    .selectFrom("wildcard as w")
    .innerJoin("wc_version as v", (j) => j.onRef("v.wildcard_id", "=", "w.id").onRef("v.seq", "=", "w.latest_seq"))
    .innerJoin("wc_ref as r", "r.src_hash", "v.hash")
    .select(["w.id as src", "r.target_wildcard_id as target"])
    .distinct()
    .where("w.owner_id", "=", ownerId)
    .where("w.deleted_at", "is", null)
    .execute();
}

/** 와일드카드 최신 버전의 해시, 크기, 문서 */
export async function latestDocs(db: Db, ids: readonly string[]): Promise<Map<string, { hash: string; size: number; doc: Doc }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("wildcard as w")
    .innerJoin("wc_version as v", (j) => j.onRef("v.wildcard_id", "=", "w.id").onRef("v.seq", "=", "w.latest_seq"))
    .innerJoin("wc_content as c", "c.hash", "v.hash")
    .select(["w.id", "c.hash", "c.size", "c.doc"])
    .where("w.id", "in", [...ids])
    .execute();
  return new Map(rows.map((r) => [r.id, { hash: r.hash, size: r.size, doc: r.doc }]));
}

/** ownerId의 지우지 않은 와일드카드 최신 버전 크기(정규화 JSON 바이트). 묶음 크기 경고에 쓴다 */
export async function ownerSizes(db: Db, ownerId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("wildcard as w")
    .innerJoin("wc_version as v", (j) => j.onRef("v.wildcard_id", "=", "w.id").onRef("v.seq", "=", "w.latest_seq"))
    .innerJoin("wc_content as c", "c.hash", "v.hash")
    .select(["w.id", "c.size"])
    .where("w.owner_id", "=", ownerId)
    .where("w.deleted_at", "is", null)
    .execute();
  return new Map(rows.map((r) => [r.id, r.size]));
}

export async function contentDocs(db: Db, hashes: readonly string[]): Promise<Map<string, Doc>> {
  if (hashes.length === 0) return new Map();
  const rows = await db.selectFrom("wc_content").select(["hash", "doc"]).where("hash", "in", [...hashes]).execute();
  return new Map(rows.map((r) => [r.hash, r.doc]));
}

/**
 * 내용을 넣는다. 같은 해시가 이미 있으면 넣지 않고 저장된 문서를 돌려준다.
 * ON CONFLICT DO NOTHING은 동시 저장 경합을 위한 것이고, 부르는 쪽이 저장된 문서와 바이트 비교한다(DESIGN 5절 6단계).
 */
export async function insertContent(db: Db, hash: string, canonical: string, size: number): Promise<{ inserted: true } | { inserted: false; doc: Doc }> {
  const r = await db
    .insertInto("wc_content")
    .values({ hash, doc: canonical, size })
    .onConflict((oc) => oc.column("hash").doNothing())
    .returning("hash")
    .executeTakeFirst();
  if (r) return { inserted: true };
  const row = await db.selectFrom("wc_content").select("doc").where("hash", "=", hash).executeTakeFirstOrThrow();
  return { inserted: false, doc: row.doc };
}

/** 내용에서 파생한 참조. 같은 내용이면 같은 행이므로 겹치면 건너뛴다. */
export async function insertRefs(db: Db, hash: string, refs: ReadonlyArray<{ item: string; target: string }>): Promise<void> {
  if (refs.length === 0) return;
  await db
    .insertInto("wc_ref")
    .values(refs.map((r) => ({ src_hash: hash, item_id: r.item, target_wildcard_id: r.target })))
    .onConflict((oc) => oc.columns(["src_hash", "item_id", "target_wildcard_id"]).doNothing())
    .execute();
}

export async function insertWildcard(
  db: Db,
  w: { id: string; ownerId: string; name: string; description: string; fixed: boolean; categories: number[]; forkedFrom: { wildcard: string; hash: string } | null },
): Promise<void> {
  await db
    .insertInto("wildcard")
    .values({
      id: w.id,
      owner_id: w.ownerId,
      name: w.name,
      description: w.description,
      fixed: w.fixed,
      latest_seq: 0,
      categories: w.categories,
      forked_from_wildcard: w.forkedFrom?.wildcard ?? null,
      forked_from_hash: w.forkedFrom?.hash ?? null,
      deleted_at: null,
    })
    .execute();
}

/** 새 버전을 붙이고 latest_seq를 올린다. 소유자 잠금 안에서 부른다. */
export async function appendVersion(
  db: Db,
  id: string,
  hash: string,
  meta: { name: string; description: string; fixed: boolean },
  categories: number[] | undefined,
): Promise<number> {
  const { latest_seq } = await db
    .updateTable("wildcard")
    .set((eb) => ({ latest_seq: eb("latest_seq", "+", 1), name: meta.name, description: meta.description, fixed: meta.fixed, ...(categories ? { categories } : {}) }))
    .where("id", "=", id)
    .returning("latest_seq")
    .executeTakeFirstOrThrow();
  await db.insertInto("wc_version").values({ wildcard_id: id, seq: latest_seq, hash }).execute();
  return latest_seq;
}

export async function setCategories(db: Db, id: string, categories: number[]): Promise<void> {
  await db.updateTable("wildcard").set({ categories }).where("id", "=", id).execute();
}

export async function setExample(db: Db, id: string, example: string | null): Promise<void> {
  await db.updateTable("wildcard").set({ example }).where("id", "=", id).execute();
}

export async function markDeleted(db: Db, id: string): Promise<void> {
  await db.updateTable("wildcard").set({ deleted_at: sql<Date>`now()` }).where("id", "=", id).execute();
}

/**
 * 루트의 최신 버전에서 닿는 와일드카드의 최신 버전 전부 (DESIGN 6절 재귀 CTE). UNION이 다이아몬드 중복을 없앤다.
 * 지운 와일드카드는 따라가지 않는다. 그런 참조가 남아 있으면 묶음이 닫히지 않아 부르는 쪽 검사에 걸린다.
 */
export async function latestClosure(db: Db, rootId: string): Promise<Array<{ wildcard_id: string; hash: string; doc: Doc; categories: number[] }>> {
  const r = await sql<{ wildcard_id: string; hash: string; doc: Doc; categories: number[] }>`
    WITH RECURSIVE deps(wildcard_id, hash) AS (
      SELECT w.id, v.hash
      FROM wildcard w
      JOIN wc_version v ON v.wildcard_id = w.id AND v.seq = w.latest_seq
      WHERE w.id = ${rootId} AND w.deleted_at IS NULL
      UNION
      SELECT w.id, v.hash
      FROM deps d
      JOIN wc_ref r     ON r.src_hash = d.hash
      JOIN wildcard w   ON w.id = r.target_wildcard_id AND w.deleted_at IS NULL
      JOIN wc_version v ON v.wildcard_id = w.id AND v.seq = w.latest_seq
    )
    SELECT d.wildcard_id, d.hash, c.doc, w.categories
    FROM deps d JOIN wc_content c USING (hash) JOIN wildcard w ON w.id = d.wildcard_id
  `.execute(db);
  return r.rows;
}

/** 이 와일드카드를 최신 버전에서 (직접 또는 건너서) 참조하는 지우지 않은 와일드카드와 가장 짧은 거리 */
export async function dependents(db: Db, id: string): Promise<Array<{ id: string; name: string; depth: number }>> {
  const r = await sql<{ id: string; name: string; depth: number }>`
    WITH RECURSIVE up(wildcard_id, depth) AS (
      SELECT ${id}::char(12), 0
      UNION
      SELECT w.id, u.depth + 1
      FROM up u
      JOIN wc_ref r     ON r.target_wildcard_id = u.wildcard_id
      JOIN wc_version v ON v.hash = r.src_hash
      JOIN wildcard w   ON w.id = v.wildcard_id AND w.latest_seq = v.seq AND w.deleted_at IS NULL
      WHERE u.depth < 64
    )
    SELECT w.id, w.name, min(u.depth)::int AS depth
    FROM up u JOIN wildcard w ON w.id = u.wildcard_id
    WHERE u.depth > 0
    GROUP BY w.id, w.name
    ORDER BY depth, w.name
  `.execute(db);
  return r.rows;
}

/** ownerId가 가진, sourceIds를 원본으로 하는 지우지 않은 복사본. 원본마다 가장 먼저 만든 것 하나 */
export async function findCopies(db: Db, ownerId: string, sourceIds: readonly string[]): Promise<Map<string, { id: string; name: string }>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("wildcard")
    .select(["id", "name", "forked_from_wildcard"])
    .where("owner_id", "=", ownerId)
    .where("deleted_at", "is", null)
    .where("forked_from_wildcard", "in", [...sourceIds])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const out = new Map<string, { id: string; name: string }>();
  for (const r of rows) if (!out.has(r.forked_from_wildcard!)) out.set(r.forked_from_wildcard!, { id: r.id, name: r.name });
  return out;
}

export async function liveNames(db: Db, ownerId: string): Promise<string[]> {
  const rows = await db.selectFrom("wildcard").select("name").where("owner_id", "=", ownerId).where("deleted_at", "is", null).execute();
  return rows.map((r) => r.name);
}

/** lock 쌍 (ID, 해시)가 실제 버전인 것. 와일드카드의 소유자와 지움 여부를 같이 돌려준다 */
export async function versionPairs(db: Db, pairs: ReadonlyArray<readonly [string, string]>) {
  if (pairs.length === 0) return [];
  const r = await sql<{ wildcard_id: string; hash: string; owner_id: string; deleted: boolean }>`
    SELECT DISTINCT v.wildcard_id, v.hash, w.owner_id, (w.deleted_at IS NOT NULL) AS deleted
    FROM unnest(${pairs.map((p) => p[0])}::text[], ${pairs.map((p) => p[1])}::text[]) AS p(id, hash)
    JOIN wc_version v ON v.wildcard_id = p.id AND v.hash = p.hash
    JOIN wildcard w   ON w.id = v.wildcard_id
  `.execute(db);
  return r.rows;
}
