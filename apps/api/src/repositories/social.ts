// 즐겨찾기, 좋아요, 둘러보기, 여러 ID 조회, 사용자별 목록 SQL (DESIGN 7절).
// 모든 값은 바인딩한다. 정렬은 서비스가 zod enum으로 받은 값으로만 고른다. 검색어는 LIKE 특수문자를 이스케이프한다(DESIGN 9절 3항).

import { sql } from "kysely";
import type { Db } from "../db/connect.ts";
import { wildcardQuery, type WildcardRow } from "./wildcards.ts";

export type CardRow = WildcardRow & { liked: boolean; favorited: boolean };

/** ILIKE 패턴 안에서 글자 그대로 쓰이도록 \ % _ 앞에 \를 붙인다(Postgres LIKE의 기본 이스케이프 문자는 \) */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** 보는 사람의 좋아요·즐겨찾기 여부를 붙인다. 로그인하지 않았으면 둘 다 false */
function withViewer(db: Db, viewerId: string | null) {
  const q = wildcardQuery(db);
  if (viewerId === null) return q.select([sql<boolean>`false`.as("liked"), sql<boolean>`false`.as("favorited")]);
  return q.select((eb) => [
    eb.exists(eb.selectFrom("wc_like as l").select("l.owner_id").whereRef("l.wildcard_id", "=", "w.id").where("l.owner_id", "=", viewerId)).$castTo<boolean>().as("liked"),
    eb.exists(eb.selectFrom("favorite as f").select("f.owner_id").whereRef("f.wildcard_id", "=", "w.id").where("f.owner_id", "=", viewerId)).$castTo<boolean>().as("favorited"),
  ]);
}

export interface ExploreQuery {
  q: string | null;
  cats: number[];
  sort: "popular" | "recent";
  offset: number;
  limit: number;
  viewerId: string | null;
}

/** 둘러보기: 지우지 않은 원본만(가져온 복사본 제외, DESIGN 11절). q는 이름·설명 부분 일치, cats는 하나라도 겹치면 */
export async function explore(db: Db, x: ExploreQuery): Promise<CardRow[]> {
  let q = withViewer(db, x.viewerId).where("w.deleted_at", "is", null).where("w.forked_from_wildcard", "is", null);
  if (x.q !== null) {
    const pattern = "%" + escapeLike(x.q) + "%";
    q = q.where((eb) => eb.or([eb("w.name", "ilike", pattern), eb("w.description", "ilike", pattern)]));
  }
  if (x.cats.length > 0) q = q.where(sql<boolean>`w.categories && ${x.cats}::smallint[]`);
  q = x.sort === "popular" ? q.orderBy("w.like_count", "desc").orderBy("w.id") : q.orderBy("v.created_at", "desc").orderBy("w.id");
  return q.limit(x.limit).offset(x.offset).execute();
}

export async function lookup(db: Db, ids: readonly string[], viewerId: string | null): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  return withViewer(db, viewerId).where("w.id", "in", [...ids]).where("w.deleted_at", "is", null).execute();
}

export async function card(db: Db, id: string, viewerId: string | null): Promise<CardRow | undefined> {
  return withViewer(db, viewerId).where("w.id", "=", id).where("w.deleted_at", "is", null).executeTakeFirst();
}

export async function ownerByUsername(db: Db, username: string) {
  return db
    .selectFrom("owner")
    .select(["id", "username"])
    .where(sql<string>`lower(username)`, "=", sql<string>`lower(${username})`)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

/** 사용자별 목록. 복사본도 나온다(원작자 표시는 forked_from_owner) */
export async function listByOwner(db: Db, ownerId: string, viewerId: string | null): Promise<CardRow[]> {
  return withViewer(db, viewerId).where("w.owner_id", "=", ownerId).where("w.deleted_at", "is", null).orderBy("w.name").execute();
}

// ---------------------------------------------------------------- 즐겨찾기

export async function listFavorites(db: Db, ownerId: string): Promise<CardRow[]> {
  return withViewer(db, ownerId)
    .innerJoin("favorite as fav", "fav.wildcard_id", "w.id")
    .where("fav.owner_id", "=", ownerId)
    .where("w.deleted_at", "is", null)
    .orderBy("fav.created_at", "desc")
    .orderBy("w.id")
    .execute();
}

export async function addFavorite(db: Db, ownerId: string, wildcardId: string): Promise<boolean> {
  const r = await db
    .insertInto("favorite")
    .values({ owner_id: ownerId, wildcard_id: wildcardId })
    .onConflict((oc) => oc.columns(["owner_id", "wildcard_id"]).doNothing())
    .returning("wildcard_id")
    .executeTakeFirst();
  return r !== undefined;
}

export async function removeFavorite(db: Db, ownerId: string, wildcardId: string): Promise<boolean> {
  const r = await db.deleteFrom("favorite").where("owner_id", "=", ownerId).where("wildcard_id", "=", wildcardId).returning("wildcard_id").executeTakeFirst();
  return r !== undefined;
}

// ---------------------------------------------------------------- 좋아요 (like_count는 같은 트랜잭션에서)

/** 좋아요를 넣고 like_count를 올린다. 이미 있으면 그대로. 트랜잭션 안에서 부른다 */
export async function like(db: Db, ownerId: string, wildcardId: string): Promise<number> {
  const inserted = await db
    .insertInto("wc_like")
    .values({ owner_id: ownerId, wildcard_id: wildcardId })
    .onConflict((oc) => oc.columns(["owner_id", "wildcard_id"]).doNothing())
    .returning("wildcard_id")
    .executeTakeFirst();
  return inserted ? bumpLikes(db, wildcardId, 1) : likeCount(db, wildcardId);
}

/** 좋아요를 지우고 like_count를 내린다. 없으면 그대로. 트랜잭션 안에서 부른다 */
export async function unlike(db: Db, ownerId: string, wildcardId: string): Promise<number> {
  const deleted = await db.deleteFrom("wc_like").where("owner_id", "=", ownerId).where("wildcard_id", "=", wildcardId).returning("wildcard_id").executeTakeFirst();
  return deleted ? bumpLikes(db, wildcardId, -1) : likeCount(db, wildcardId);
}

async function bumpLikes(db: Db, wildcardId: string, delta: 1 | -1): Promise<number> {
  const r = await db
    .updateTable("wildcard")
    .set((eb) => ({ like_count: eb("like_count", "+", delta) }))
    .where("id", "=", wildcardId)
    .returning("like_count")
    .executeTakeFirstOrThrow();
  return r.like_count;
}

async function likeCount(db: Db, wildcardId: string): Promise<number> {
  return (await db.selectFrom("wildcard").select("like_count").where("id", "=", wildcardId).executeTakeFirstOrThrow()).like_count;
}
