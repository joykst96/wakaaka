// 계정과 세션 (DESIGN 9절). 비밀번호는 argon2id, 세션 토큰은 DB에 sha256만 남긴다.

import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import * as owners from "../repositories/owners.ts";

export const USERNAME = /^[A-Za-z0-9_-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
export const SESSION_DAYS = 30;

const ARGON2 = { type: argon2.argon2id } as const;
// 없는 아이디로 로그인할 때도 같은 시간이 걸리게 대신 검증할 해시. 처음 쓸 때 만든다.
let dummyHash: Promise<string> | undefined;

export const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function checkPassword(pw: string): void {
  const n = [...pw].length;
  if (!pw.isWellFormed() || n < PASSWORD_MIN || n > PASSWORD_MAX) {
    throw new ApiError(400, "E_PASSWORD", `password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
  }
}

async function newSession(db: Db, ownerId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await owners.insertSession(db, tokenHash(token), ownerId, new Date(Date.now() + SESSION_DAYS * 86400_000));
  return token;
}

export async function signup(db: Db, username: string, password: string) {
  if (!USERNAME.test(username)) throw new ApiError(400, "E_USERNAME", "username must be 3-32 characters of A-Z a-z 0-9 _ -");
  checkPassword(password);
  const pwHash = await argon2.hash(password, ARGON2);
  let owner: owners.OwnerRow;
  try {
    owner = await owners.insertOwner(db, username, pwHash);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ApiError(409, "E_USERNAME_TAKEN", "username is taken");
    throw e;
  }
  return { owner, token: await newSession(db, owner.id) };
}

export async function login(db: Db, username: string, password: string) {
  const fail = new ApiError(401, "E_LOGIN", "wrong username or password");
  if (!USERNAME.test(username) || !password.isWellFormed() || [...password].length > PASSWORD_MAX) throw fail;
  const row = await owners.findOwnerForLogin(db, username);
  if (!row) {
    dummyHash ??= argon2.hash("wakaaka-dummy-password", ARGON2);
    await argon2.verify(await dummyHash, password);
    throw fail;
  }
  if (!(await argon2.verify(row.pw_hash, password))) throw fail;
  await owners.deleteExpiredSessions(db, row.id);
  return { owner: { id: row.id, username: row.username }, token: await newSession(db, row.id) };
}

export async function logout(db: Db, token: string): Promise<void> {
  await owners.deleteSession(db, tokenHash(token));
}

export async function sessionOwner(db: Db, token: string) {
  return owners.findSessionOwner(db, tokenHash(token));
}

/** 비밀번호 변경: 현재 비밀번호를 확인하고, 지금 쓰는 세션만 남기고 나머지 세션을 끊는다 */
export async function changePassword(db: Db, ownerId: string, currentToken: string, current: string, next: string): Promise<void> {
  const row = await owners.findOwnerPassword(db, ownerId);
  const wrong = new ApiError(400, "E_PASSWORD_WRONG", "current password is wrong");
  if (!row || !current.isWellFormed() || [...current].length > PASSWORD_MAX) throw wrong;
  if (!(await argon2.verify(row.pw_hash, current))) throw wrong;
  checkPassword(next);
  await owners.setPassword(db, ownerId, await argon2.hash(next, ARGON2));
  await owners.deleteOtherSessions(db, ownerId, tokenHash(currentToken));
}
