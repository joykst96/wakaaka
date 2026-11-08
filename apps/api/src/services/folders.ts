// 나만 보는 폴더 (DESIGN 11절 "폴더", 사용자 결정 2026-11-08): 한 단계, 와일드카드마다 폴더 하나, "폴더 없음" = NULL.
// 폴더 정보는 여기 응답에만 나온다. 와일드카드 목록·조회·둘러보기·/api/w/*의 응답은 바꾸지 않는다.
// 쓰기는 모두 소유자를 잠근 트랜잭션에서 한다(이름 유일·개수 상한 검사가 동시 요청 사이에서 깨지지 않게).
// 폴더를 옮겨도 새 버전이 생기지 않는다(분류와 같다).

import { BASE62_12, isSafeString, trimSpecWhitespace } from "@wakaaka/core";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import { lockOwner } from "../repositories/owners.ts";
import * as repo from "../repositories/folders.ts";
import { newWildcardId } from "./docs.ts";
import type { Owner } from "./wildcards.ts";

export const FOLDER_NAME_MAX = 64;
/** 사용자당 폴더 수(잠정) */
export const FOLDER_MAX = 100;
/** 한 번에 옮기는 와일드카드 수 */
export const MOVE_MAX = 500;

export const folderBodySchema = z.strictObject({ name: z.string() });
/** 만들기: after가 있으면 그 폴더 바로 다음에, 없으면 맨 끝에(사용자 결정 2026-11-09, DESIGN 11절 "우클릭 메뉴") */
export const createFolderBodySchema = z.strictObject({ name: z.string(), after: z.string().optional() });
export const moveBodySchema = z.strictObject({
  folder: z.string().regex(BASE62_12).nullable(),
  wildcards: z.array(z.string().regex(BASE62_12)).min(1).max(MOVE_MAX),
});

/** 제어문자: C0 전부(탭·줄바꿈 포함)와 DEL. 폴더 이름은 한 줄이다 */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 폴더 이름 규칙: 문자열 검사, 제어문자 없음, 앞뒤 공백 없음, 코드 포인트 1~64자. 고쳐 주지 않고 거부한다(와일드카드 이름과 같다) */
export function checkFolderName(name: string): string {
  if (!isSafeString(name) || CONTROL.test(name)) throw new ApiError(400, "E_FOLDER_NAME", "folder name contains characters that are not allowed");
  if (trimSpecWhitespace(name) !== name) throw new ApiError(400, "E_FOLDER_NAME", "folder name must not start or end with whitespace");
  const n = [...name].length;
  if (n === 0) throw new ApiError(400, "E_FOLDER_NAME", "folder name is required");
  if (n > FOLDER_NAME_MAX) throw new ApiError(400, "E_FOLDER_NAME", `folder name must be at most ${FOLDER_NAME_MAX} characters`);
  return name;
}

function nameTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err.code === "23505" && err.constraint === "wc_folder_owner_name_lower";
}

async function withOwnerLock<T>(db: Db, owner: Owner, fn: (tx: Db) => Promise<T>): Promise<T> {
  try {
    return await db.transaction().execute(async (tx) => {
      await lockOwner(tx, owner.id);
      return fn(tx);
    });
  } catch (e) {
    if (nameTaken(e)) throw new ApiError(409, "E_FOLDER_NAME_TAKEN", "you already have a folder with this name");
    throw e;
  }
}

async function ownedFolder(db: Db, owner: Owner, id: string): Promise<repo.FolderRow> {
  const f = BASE62_12.test(id) ? await repo.getFolder(db, owner.id, id) : undefined;
  // 남의 폴더는 없는 것과 같다(있는지도 알리지 않는다)
  if (!f) throw new ApiError(404, "E_FOLDER_NOT_FOUND", "folder not found");
  return f;
}

export interface FolderView {
  id: string;
  name: string;
  /** 든 와일드카드 ID. 지운 것은 빠진다. 순서는 내 목록과 같은 이름순. 폴더 자체의 순서는 목록 배열 순서(position)로만 알린다 */
  wildcards: string[];
}

export async function listFolders(db: Db, owner: Owner): Promise<{ folders: FolderView[] }> {
  const folders = await repo.listFolders(db, owner.id);
  const members = new Map<string, string[]>(folders.map((f) => [f.id, []]));
  for (const m of await repo.listMembers(db, owner.id)) members.get(m.folder_id)?.push(m.id);
  return { folders: folders.map((f) => ({ id: f.id, name: f.name, wildcards: members.get(f.id) ?? [] })) };
}

/** 폴더를 만든다. after(내 폴더 ID)가 있으면 그 바로 다음 자리, 없으면 맨 끝. 남의·없는 after는 404 */
export async function createFolder(db: Db, owner: Owner, rawName: string, after?: string): Promise<FolderView> {
  const name = checkFolderName(rawName);
  return withOwnerLock(db, owner, async (tx) => {
    if ((await repo.countFolders(tx, owner.id)) >= FOLDER_MAX) throw new ApiError(409, "E_FOLDER_LIMIT", `you can have at most ${FOLDER_MAX} folders`);
    let position: number;
    if (after === undefined) position = await repo.nextPosition(tx, owner.id);
    else {
      position = (await ownedFolder(tx, owner, after)).position + 1;
      await repo.shiftFrom(tx, owner.id, position);
    }
    const id = newWildcardId();
    await repo.insertFolder(tx, owner.id, id, name, position);
    return { id, name, wildcards: [] };
  });
}

export async function renameFolder(db: Db, owner: Owner, id: string, rawName: string): Promise<{ id: string; name: string }> {
  const name = checkFolderName(rawName);
  return withOwnerLock(db, owner, async (tx) => {
    await ownedFolder(tx, owner, id);
    await repo.renameFolder(tx, owner.id, id, name);
    return { id, name };
  });
}

/** 폴더를 지운다. 든 와일드카드는 지우지 않고 "폴더 없음"으로 옮긴다. moved는 옮긴 지우지 않은 와일드카드 수 */
export async function deleteFolder(db: Db, owner: Owner, id: string): Promise<{ ok: true; moved: number }> {
  return withOwnerLock(db, owner, async (tx) => {
    await ownedFolder(tx, owner, id);
    const moved = await repo.countMembers(tx, owner.id, id);
    await repo.deleteFolder(tx, owner.id, id);
    return { ok: true, moved };
  });
}

/**
 * 내 와일드카드들을 폴더 하나로(null이면 "폴더 없음"으로) 옮긴다. 하나라도 걸리면 아무것도 옮기지 않는다.
 * 남의 폴더 404, 없거나 지운 와일드카드 404, 남의 와일드카드 403(와일드카드는 공개라 있는지는 숨기지 않는다. 수정·삭제와 같다).
 */
export async function moveWildcards(db: Db, owner: Owner, folder: string | null, ids: string[]): Promise<{ folder: string | null; moved: number }> {
  const unique = [...new Set(ids)];
  return withOwnerLock(db, owner, async (tx) => {
    if (folder !== null) await ownedFolder(tx, owner, folder);
    const rows = new Map((await repo.wildcardOwners(tx, unique)).map((r) => [r.id, r]));
    const missing = unique.filter((id) => !rows.has(id) || rows.get(id)!.deleted);
    if (missing.length > 0) throw new ApiError(404, "E_NOT_FOUND", "wildcard not found", { wildcards: missing });
    const others = unique.filter((id) => rows.get(id)!.owner_id !== owner.id);
    if (others.length > 0) throw new ApiError(403, "E_FORBIDDEN", "not your wildcard", { wildcards: others });
    const moved = await repo.moveWildcards(tx, owner.id, unique, folder);
    if (moved !== unique.length) throw new Error(`bug: moved ${moved} of ${unique.length}`);
    return { folder, moved };
  });
}
