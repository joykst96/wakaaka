// 즐겨찾기, 좋아요, 둘러보기, 여러 ID 조회, 사용자별 목록 (DESIGN 7절, 11절).
// 쿼리 문자열과 본문은 zod 엄격 스키마로 받는다. 정렬은 enum, 분류는 숫자 목록, 검색어는 문자열 검사를 거친다.

import { BASE62_12, isSafeString, trimSpecWhitespace } from "@wakaaka/core";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import * as repo from "../repositories/social.ts";
import { getWildcard as getRow } from "../repositories/wildcards.ts";
import { USERNAME } from "./auth.ts";
import { CATEGORY_MAX, wildcardView, type Owner } from "./wildcards.ts";

export const EXPLORE_PAGE = 30;
export const EXPLORE_MAX_OFFSET = 10_000;
export const Q_MAX = 100;
export const LOOKUP_MAX = 200;

export function cardView(r: repo.CardRow) {
  return { ...wildcardView(r), liked: r.liked, favorited: r.favorited };
}

function parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String), message: i.message }));
    throw new ApiError(400, "E_QUERY", "query does not match the schema", { issues });
  }
  return r.data;
}

/** /api/explore 쿼리. 모르는 매개변수는 거부한다 */
export const exploreQuerySchema = z.strictObject({
  q: z.string().max(Q_MAX * 4).optional(),
  cat: z.string().regex(/^[0-9]{1,2}(,[0-9]{1,2}){0,12}$/).optional(),
  sort: z.enum(["popular", "recent"]).optional(),
  offset: z.string().regex(/^[0-9]{1,5}$/).optional(),
  /** 1 고정만, 0 고정 빼고 (DESIGN 3절 "고정 표시") */
  fixed: z.enum(["1", "0"]).optional(),
});

export async function explore(db: Db, viewer: Owner | null, query: Record<string, string>) {
  const x = parseQuery(exploreQuerySchema, query);
  let q: string | null = null;
  if (x.q !== undefined) {
    if (!isSafeString(x.q)) throw new ApiError(400, "E_QUERY", "q contains characters that are not allowed");
    const t = trimSpecWhitespace(x.q);
    if ([...t].length > Q_MAX) throw new ApiError(400, "E_QUERY", `q must be at most ${Q_MAX} characters`);
    q = t === "" ? null : t;
  }
  const cats = x.cat === undefined ? [] : [...new Set(x.cat.split(",").map(Number))].sort((a, b) => a - b);
  if (cats.some((c) => c < 1 || c > CATEGORY_MAX)) throw new ApiError(400, "E_QUERY", `cat must be numbers in 1..${CATEGORY_MAX}`);
  const offset = x.offset === undefined ? 0 : Number(x.offset);
  if (offset > EXPLORE_MAX_OFFSET) throw new ApiError(400, "E_QUERY", `offset must be at most ${EXPLORE_MAX_OFFSET}`);
  // 한 개 더 읽어 다음 쪽이 있는지 안다
  const fixed = x.fixed === undefined ? null : x.fixed === "1";
  const rows = await repo.explore(db, { q, cats, fixed, sort: x.sort ?? "popular", offset, limit: EXPLORE_PAGE + 1, viewerId: viewer?.id ?? null });
  const more = rows.length > EXPLORE_PAGE;
  return { wildcards: rows.slice(0, EXPLORE_PAGE).map(cardView), nextOffset: more ? offset + EXPLORE_PAGE : null };
}

export const lookupBodySchema = z.strictObject({ ids: z.array(z.string().regex(BASE62_12)).max(LOOKUP_MAX) });

/** 여러 ID의 메타데이터. 없거나 지운 ID는 결과에 넣지 않는다 */
export async function lookup(db: Db, viewer: Owner | null, ids: string[]) {
  const rows = await repo.lookup(db, [...new Set(ids)], viewer?.id ?? null);
  const out: Record<string, ReturnType<typeof cardView>> = {};
  for (const r of rows.sort((a, b) => (a.id < b.id ? -1 : 1))) out[r.id] = cardView(r);
  return { wildcards: out };
}

export async function userWildcards(db: Db, viewer: Owner | null, username: string) {
  const o = USERNAME.test(username) ? await repo.ownerByUsername(db, username) : undefined;
  if (!o) throw new ApiError(404, "E_NOT_FOUND", "user not found");
  return { user: { username: o.username }, wildcards: (await repo.listByOwner(db, o.id, viewer?.id ?? null)).map(cardView) };
}

/** 와일드카드 상세에 붙이는 보는 사람 기준 정보 */
export async function viewerFlags(db: Db, viewer: Owner | null, id: string) {
  const r = await repo.card(db, id, viewer?.id ?? null);
  return { liked: r?.liked ?? false, favorited: r?.favorited ?? false };
}

/** 남의 지우지 않은 와일드카드 (즐겨찾기·좋아요 대상) */
async function othersLive(db: Db, owner: Owner, id: string, ownCode: string) {
  const w = await getRow(db, id);
  if (!w || w.deleted_at !== null) throw new ApiError(404, "E_NOT_FOUND", "wildcard not found");
  if (w.owner_id === owner.id) throw new ApiError(400, ownCode, "this wildcard is yours");
  return w;
}

// ---------------------------------------------------------------- 즐겨찾기

export const favoriteBodySchema = z.strictObject({ wildcard: z.string().regex(BASE62_12) });

export async function listFavorites(db: Db, owner: Owner) {
  return { favorites: (await repo.listFavorites(db, owner.id)).map(cardView) };
}

export async function addFavorite(db: Db, owner: Owner, id: string) {
  await othersLive(db, owner, id, "E_FAVORITE_OWN");
  return { added: await repo.addFavorite(db, owner.id, id), favorited: true };
}

/** 지운 와일드카드의 즐겨찾기도 지울 수 있다(목록에는 안 나오지만 행은 남는다) */
export async function removeFavorite(db: Db, owner: Owner, id: string) {
  return { removed: await repo.removeFavorite(db, owner.id, id), favorited: false };
}

// ---------------------------------------------------------------- 좋아요

export async function setLike(db: Db, owner: Owner, id: string, on: boolean) {
  return db.transaction().execute(async (tx) => {
    await othersLive(tx, owner, id, "E_LIKE_OWN");
    const likes = on ? await repo.like(tx, owner.id, id) : await repo.unlike(tx, owner.id, id);
    return { liked: on, likes };
  });
}
