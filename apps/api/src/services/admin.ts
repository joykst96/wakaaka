// 관리 (DESIGN 9절 "관리", 사용자 결정 2026-11-04). 웹·API에는 붙이지 않는다. admin.ts(CLI)만 부른다.
// 함수마다 apply=false면 할 일만 계산하고(트랜잭션을 되돌림) apply=true면 실행한다. 계산과 실행이 같은 코드를 지난다.

import { BASE62_12 } from "@wakaaka/core";
import { sql } from "kysely";
import type { Db } from "../db/connect.ts";
import { lockOwner } from "../repositories/owners.ts";
import * as repo from "../repositories/wildcards.ts";
import { USERNAME } from "./auth.ts";

/** 관리 명령의 거부. CLI가 메시지를 보여 주고 종료 코드 1로 끝낸다 */
export class AdminError extends Error {}

export interface WcBrief {
  id: string;
  name: string;
  owner: string;
}

/** 트랜잭션 안에서 계산하고, apply가 아니면 되돌린다(바뀐 것이 남지 않음을 DB가 보장) */
class DryRun extends Error {
  readonly value: unknown;
  constructor(value: unknown) {
    super("dry run");
    this.value = value;
  }
}
async function inTx<T>(db: Db, apply: boolean, fn: (tx: Db) => Promise<T>): Promise<T> {
  try {
    return await db.transaction().execute(async (tx) => {
      const r = await fn(tx);
      if (!apply) throw new DryRun(r);
      return r;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.value as T;
    throw e;
  }
}

function checkId(id: string): void {
  if (!BASE62_12.test(id)) throw new AdminError(`not a wildcard ID (base62, 12 characters): ${JSON.stringify(id)}`);
}
function checkUsername(username: string): void {
  if (!USERNAME.test(username)) throw new AdminError(`not a username ([A-Za-z0-9_-], 3-32): ${JSON.stringify(username)}`);
}

async function ownerOf(db: Db, username: string) {
  checkUsername(username);
  const o = await db
    .selectFrom("owner")
    .select(["id", "username", "created_at", "deleted_at"])
    .where(sql<string>`lower(username)`, "=", sql<string>`lower(${username})`)
    .executeTakeFirst();
  if (!o) throw new AdminError(`no such account: ${username}`);
  return o;
}

// ---------------------------------------------------------------- 보기

export async function showWildcard(db: Db, id: string) {
  checkId(id);
  const w = await repo.getWildcard(db, id);
  if (!w) throw new AdminError(`no such wildcard: ${id}`);
  const copies = await db
    .selectFrom("wildcard as w")
    .innerJoin("owner as o", "o.id", "w.owner_id")
    .select(["w.id", "w.name", "o.username as owner"])
    .where("w.forked_from_wildcard", "=", id)
    .where("w.deleted_at", "is", null)
    .orderBy("w.id")
    .execute();
  return {
    id: w.id,
    name: w.name,
    owner: w.owner,
    version: w.latest_seq,
    likes: w.like_count,
    forkedFrom: w.forked_from_wildcard,
    createdAt: w.created_at,
    deletedAt: w.deleted_at,
    /** 같은 소유자의 최신 버전이 (건너서) 참조하는 것. 강제 삭제 때 함께 지워진다 */
    dependents: w.deleted_at === null ? await repo.dependents(db, id) : [],
    /** 남이 가져간 복사본. 강제 삭제해도 그대로 남는다 */
    copies,
  };
}

export async function showAccount(db: Db, username: string) {
  const o = await ownerOf(db, username);
  const wildcards = await db
    .selectFrom("wildcard")
    .select(["id", "name", "latest_seq", "like_count", "forked_from_wildcard", "deleted_at"])
    .where("owner_id", "=", o.id)
    .orderBy("deleted_at", (ob) => ob.desc().nullsFirst())
    .orderBy("name")
    .execute();
  const sessions = await db.selectFrom("session").select(sql<number>`count(*)::int`.as("n")).where("owner_id", "=", o.id).where("expires_at", ">", sql<Date>`now()`).executeTakeFirstOrThrow();
  return { username: o.username, createdAt: o.created_at, deletedAt: o.deleted_at, sessions: sessions.n, wildcards };
}

// ---------------------------------------------------------------- 와일드카드 강제 삭제

/**
 * 소유자와 상관없이 지운다. 같은 소유자의 다른 와일드카드 최신 버전이 (건너서) 참조하면 그것들도 함께 지운다
 * (일반 삭제의 409 대신). 참조는 같은 소유자 안에만 있으므로(DESIGN 2절 1항) 다른 계정은 영향을 받지 않는다.
 */
export async function deleteWildcard(db: Db, id: string, apply: boolean): Promise<{ deleted: WcBrief[] }> {
  checkId(id);
  return inTx(db, apply, async (tx) => {
    const w = await repo.getWildcard(tx, id);
    if (!w) throw new AdminError(`no such wildcard: ${id}`);
    if (w.deleted_at !== null) throw new AdminError(`already deleted: ${id} (${w.name})`);
    await lockOwner(tx, w.owner_id);
    const deps = await repo.dependents(tx, id);
    const targets = [{ id: w.id, name: w.name }, ...deps.map(({ id, name }) => ({ id, name }))];
    await tx
      .updateTable("wildcard")
      .set({ deleted_at: sql<Date>`now()` })
      .where("id", "in", targets.map((t) => t.id))
      .where("deleted_at", "is", null)
      .execute();
    // 지운 뒤 같은 소유자의 살아 있는 최신 버전이 지운 것을 참조하면 안 된다(묶음이 닫히지 않는다)
    const dangling = await danglingRefs(tx, w.owner_id);
    if (dangling.length > 0) throw new Error(`bug: dangling references after delete: ${JSON.stringify(dangling)}`);
    return { deleted: targets.map((t) => ({ ...t, owner: w.owner })) };
  });
}

/** ownerId의 지우지 않은 와일드카드 최신 버전이 참조하는, 지운 와일드카드 */
async function danglingRefs(db: Db, ownerId: string) {
  const r = await sql<{ src: string; target: string }>`
    SELECT w.id AS src, t.id AS target
    FROM wildcard w
    JOIN wc_version v ON v.wildcard_id = w.id AND v.seq = w.latest_seq
    JOIN wc_ref r     ON r.src_hash = v.hash
    JOIN wildcard t   ON t.id = r.target_wildcard_id
    WHERE w.owner_id = ${ownerId} AND w.deleted_at IS NULL AND t.deleted_at IS NOT NULL
    ORDER BY 1, 2
  `.execute(db);
  return r.rows;
}

// ---------------------------------------------------------------- 계정 삭제

export interface DeleteAccountResult {
  username: string;
  wildcards: number;
  sessions: number;
  favorites: number;
  /** 이 계정이 남에게 준 좋아요(받은 쪽 like_count를 내린다) */
  likes: number;
}

/** 와일드카드를 모두 지우고 세션·즐겨찾기·좋아요를 지운다. 아이디는 다시 가입할 수 없게 남긴다. 되살리기는 없다 */
export async function deleteAccount(db: Db, username: string, apply: boolean): Promise<DeleteAccountResult> {
  return inTx(db, apply, async (tx) => {
    const o = await ownerOf(tx, username);
    if (o.deleted_at !== null) throw new AdminError(`account already deleted: ${o.username}`);
    await lockOwner(tx, o.id);
    const wcs = await tx.updateTable("wildcard").set({ deleted_at: sql<Date>`now()` }).where("owner_id", "=", o.id).where("deleted_at", "is", null).returning("id").execute();
    const sessions = await tx.deleteFrom("session").where("owner_id", "=", o.id).returning("token_hash").execute();
    const favorites = await tx.deleteFrom("favorite").where("owner_id", "=", o.id).returning("wildcard_id").execute();
    const likes = await tx.deleteFrom("wc_like").where("owner_id", "=", o.id).returning("wildcard_id").execute();
    // 좋아요는 계정당 한 번(PK)이라 와일드카드마다 1씩 내린다
    if (likes.length > 0) {
      await tx
        .updateTable("wildcard")
        .set((eb) => ({ like_count: eb("like_count", "-", 1) }))
        .where("id", "in", likes.map((l) => l.wildcard_id))
        .execute();
    }
    await tx.updateTable("owner").set({ deleted_at: sql<Date>`now()` }).where("id", "=", o.id).execute();
    return { username: o.username, wildcards: wcs.length, sessions: sessions.length, favorites: favorites.length, likes: likes.length };
  });
}

// ---------------------------------------------------------------- 되살리기

/**
 * 지운 와일드카드를 되돌린다. 함께 지운 것은 함께 준다. 모두 같은 소유자여야 한다(참조가 소유자 안에만 있으므로).
 * 거부: 지우지 않은 것, 계정이 지워짐, 이름이 그 사이 다시 쓰임(또는 준 것끼리 겹침), 되살린 뒤 최신 버전의 참조가 지운 것을 가리킴.
 * 순환은 생기지 않는다: 지운 동안에는 아무도 그것을 새로 참조할 수 없고(저장 검증), 문서의 참조는 지우기 전과 같다.
 */
export async function restoreWildcards(db: Db, ids: string[], apply: boolean): Promise<{ restored: WcBrief[] }> {
  if (ids.length === 0) throw new AdminError("give at least one wildcard ID");
  for (const id of ids) checkId(id);
  const unique = [...new Set(ids)];
  return inTx(db, apply, async (tx) => {
    const rows = [];
    for (const id of unique) {
      const w = await repo.getWildcard(tx, id);
      if (!w) throw new AdminError(`no such wildcard: ${id}`);
      if (w.deleted_at === null) throw new AdminError(`not deleted: ${id} (${w.name})`);
      rows.push(w);
    }
    const ownerId = rows[0]!.owner_id;
    if (rows.some((w) => w.owner_id !== ownerId)) throw new AdminError("all wildcards must belong to the same account");
    const o = await tx.selectFrom("owner").select(["username", "deleted_at"]).where("id", "=", ownerId).executeTakeFirstOrThrow();
    if (o.deleted_at !== null) throw new AdminError(`account is deleted: ${o.username}`);
    await lockOwner(tx, ownerId);

    const names = new Map<string, string>();
    for (const w of rows) {
      const key = w.name.toLowerCase();
      if (names.has(key)) throw new AdminError(`name collision among the given wildcards: ${JSON.stringify(w.name)} (${names.get(key)}, ${w.id})`);
      names.set(key, w.id);
    }
    const taken = new Set((await repo.liveNames(tx, ownerId)).map((n) => n.toLowerCase()));
    for (const w of rows) {
      if (taken.has(w.name.toLowerCase())) throw new AdminError(`name ${JSON.stringify(w.name)} is used again by ${o.username}; rename that one first (${w.id})`);
    }

    await tx.updateTable("wildcard").set({ deleted_at: null }).where("id", "in", unique).execute();
    const dangling = (await danglingRefs(tx, ownerId)).filter((d) => unique.includes(d.src));
    if (dangling.length > 0) {
      const missing = [...new Set(dangling.map((d) => d.target))];
      throw new AdminError(`the latest versions reference deleted wildcards; restore them together: ${missing.join(" ")}`);
    }
    return { restored: rows.map((w) => ({ id: w.id, name: w.name, owner: w.owner })) };
  });
}
