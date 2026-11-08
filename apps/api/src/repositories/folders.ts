// 나만 보는 폴더 SQL (DESIGN 11절 "폴더"). 모든 값은 바인딩한다. 소유자 조건은 모든 쿼리에 붙인다.

import type { Db } from "../db/connect.ts";

export interface FolderRow {
  id: string;
  name: string;
  position: number;
}

/** ownerId의 폴더. 사용자가 정한 순서(position, 0008). position은 사용자 안에서 유일하지만 읽는 사람을 위해 ID도 붙인다 */
export async function listFolders(db: Db, ownerId: string): Promise<FolderRow[]> {
  return db.selectFrom("wc_folder").select(["id", "name", "position"]).where("owner_id", "=", ownerId).orderBy("position").orderBy("id").execute();
}

/** ownerId의 지우지 않은 와일드카드 중 폴더에 든 것. 폴더 안 순서는 내 목록과 같은 이름순 */
export async function listMembers(db: Db, ownerId: string): Promise<Array<{ id: string; folder_id: string }>> {
  const rows = await db
    .selectFrom("wildcard")
    .select(["id", "folder_id"])
    .where("owner_id", "=", ownerId)
    .where("deleted_at", "is", null)
    .where("folder_id", "is not", null)
    .orderBy("name")
    .execute();
  return rows as Array<{ id: string; folder_id: string }>;
}

export async function countFolders(db: Db, ownerId: string): Promise<number> {
  const r = await db.selectFrom("wc_folder").select((eb) => eb.fn.countAll<string>().as("n")).where("owner_id", "=", ownerId).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** 내 폴더 하나. 남의 것이면 없는 것과 같다 */
export async function getFolder(db: Db, ownerId: string, id: string): Promise<FolderRow | undefined> {
  return db.selectFrom("wc_folder").select(["id", "name", "position"]).where("owner_id", "=", ownerId).where("id", "=", id).executeTakeFirst();
}

/** 맨 끝 다음 번호(폴더가 없으면 0) */
export async function nextPosition(db: Db, ownerId: string): Promise<number> {
  const r = await db.selectFrom("wc_folder").select((eb) => eb.fn.max("position").as("p")).where("owner_id", "=", ownerId).executeTakeFirst();
  return r?.p === null || r?.p === undefined ? 0 : Number(r.p) + 1;
}

/** position 이상인 ownerId의 폴더를 한 칸씩 뒤로. 유일 제약은 커밋 때 검사한다(0008 DEFERRABLE) */
export async function shiftFrom(db: Db, ownerId: string, position: number): Promise<void> {
  await db
    .updateTable("wc_folder")
    .set((eb) => ({ position: eb("position", "+", 1) }))
    .where("owner_id", "=", ownerId)
    .where("position", ">=", position)
    .execute();
}

export async function insertFolder(db: Db, ownerId: string, id: string, name: string, position: number): Promise<void> {
  await db.insertInto("wc_folder").values({ id, owner_id: ownerId, name, position }).execute();
}

export async function renameFolder(db: Db, ownerId: string, id: string, name: string): Promise<void> {
  await db.updateTable("wc_folder").set({ name }).where("owner_id", "=", ownerId).where("id", "=", id).execute();
}

/** 폴더를 지운다. 든 와일드카드는 FK(ON DELETE SET NULL (folder_id))가 "폴더 없음"으로 옮긴다 */
export async function deleteFolder(db: Db, ownerId: string, id: string): Promise<void> {
  await db.deleteFrom("wc_folder").where("owner_id", "=", ownerId).where("id", "=", id).execute();
}

/** 폴더에 든 지우지 않은 와일드카드 수 */
export async function countMembers(db: Db, ownerId: string, folderId: string): Promise<number> {
  const r = await db
    .selectFrom("wildcard")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("owner_id", "=", ownerId)
    .where("folder_id", "=", folderId)
    .where("deleted_at", "is", null)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** ids의 소유자와 지움 여부. 없는 ID는 빠진다 */
export async function wildcardOwners(db: Db, ids: readonly string[]): Promise<Array<{ id: string; owner_id: string; deleted: boolean }>> {
  if (ids.length === 0) return [];
  const rows = await db.selectFrom("wildcard").select(["id", "owner_id", "deleted_at"]).where("id", "in", [...ids]).execute();
  return rows.map((r) => ({ id: r.id, owner_id: r.owner_id, deleted: r.deleted_at !== null }));
}

/** ownerId의 지우지 않은 와일드카드 ids를 folderId(null = 폴더 없음)로. 버전·내용·updatedAt은 건드리지 않는다 */
export async function moveWildcards(db: Db, ownerId: string, ids: readonly string[], folderId: string | null): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await db
    .updateTable("wildcard")
    .set({ folder_id: folderId })
    .where("owner_id", "=", ownerId)
    .where("deleted_at", "is", null)
    .where("id", "in", [...ids])
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}
