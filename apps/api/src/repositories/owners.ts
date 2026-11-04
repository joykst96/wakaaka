import { sql } from "kysely";
import type { Db } from "../db/connect.ts";

export interface OwnerRow {
  id: string;
  username: string;
}

export async function insertOwner(db: Db, username: string, pwHash: string): Promise<OwnerRow> {
  return db.insertInto("owner").values({ username, pw_hash: pwHash }).returning(["id", "username"]).executeTakeFirstOrThrow();
}

/** 대소문자 무시 조회 (색인 owner_username_lower) */
export async function findOwnerForLogin(db: Db, username: string) {
  return db
    .selectFrom("owner")
    .select(["id", "username", "pw_hash"])
    .where(sql<string>`lower(username)`, "=", sql<string>`lower(${username})`)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

export async function insertSession(db: Db, tokenHash: string, ownerId: string, expiresAt: Date): Promise<void> {
  await db.insertInto("session").values({ token_hash: tokenHash, owner_id: ownerId, expires_at: expiresAt }).execute();
}

export async function findSessionOwner(db: Db, tokenHash: string) {
  return db
    .selectFrom("session as s")
    .innerJoin("owner as o", "o.id", "s.owner_id")
    .select(["o.id", "o.username", "o.created_at"])
    .where("s.token_hash", "=", tokenHash)
    .where("s.expires_at", ">", sql<Date>`now()`)
    .where("o.deleted_at", "is", null)
    .executeTakeFirst();
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.deleteFrom("session").where("token_hash", "=", tokenHash).execute();
}

export async function deleteExpiredSessions(db: Db, ownerId: string): Promise<void> {
  await db.deleteFrom("session").where("owner_id", "=", ownerId).where("expires_at", "<=", sql<Date>`now()`).execute();
}

/** 소유자 단위로 쓰기를 직렬화한다. 순환 검사가 동시 저장 둘 사이에서 깨지지 않게 한다(트랜잭션 안에서만 부른다). */
export async function lockOwner(db: Db, ownerId: string): Promise<void> {
  await db.selectFrom("owner").select("id").where("id", "=", ownerId).forUpdate().executeTakeFirstOrThrow();
}

export async function findOwnerPassword(db: Db, ownerId: string) {
  return db.selectFrom("owner").select(["id", "pw_hash"]).where("id", "=", ownerId).executeTakeFirst();
}

export async function setPassword(db: Db, ownerId: string, pwHash: string): Promise<void> {
  await db.updateTable("owner").set({ pw_hash: pwHash }).where("id", "=", ownerId).execute();
}

/** 이 소유자의 세션 중 keepTokenHash가 아닌 것을 모두 지운다 */
export async function deleteOtherSessions(db: Db, ownerId: string, keepTokenHash: string): Promise<void> {
  await db.deleteFrom("session").where("owner_id", "=", ownerId).where("token_hash", "!=", keepTokenHash).execute();
}
