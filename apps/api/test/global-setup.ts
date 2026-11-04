// 테스트 스키마 정리. 스키마는 테스트마다 만들고, 지우는 것은 전체가 끝난 뒤 한 번에 한다.
// 이유: Kysely Migrator의 introspection이 모든 스키마에 has_schema_privilege(이름)를 부르는데, 다른 테스트 파일이
// 그 사이에 DROP SCHEMA를 하면 "schema does not exist"로 실패한다(NOTES Phase 2).

import { sql } from "kysely";
import { createDb } from "../src/db/connect.ts";
import { TEST_DATABASE_URL } from "./helpers.ts";

async function dropTestSchemas(): Promise<void> {
  const db = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    const r = await sql<{ nspname: string }>`select nspname from pg_namespace where nspname ~ '^t_[0-9a-f]{12}$'`.execute(db);
    for (const { nspname } of r.rows) await sql`drop schema ${sql.id(nspname)} cascade`.execute(db);
  } finally {
    await db.destroy();
  }
}

/** 마이그레이션 0002의 pg_trgm을 미리 public에 만든다. 테스트 파일들이 동시에 CREATE EXTENSION을 하면 경합하기 때문이다 */
async function createExtensions(): Promise<void> {
  const db = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await sql`create extension if not exists pg_trgm with schema public`.execute(db);
  } finally {
    await db.destroy();
  }
}

export async function setup() {
  try {
    await dropTestSchemas();
    await createExtensions();
  } catch (e) {
    throw new Error(`test database is not reachable at ${TEST_DATABASE_URL} (npm run db:up -w @wakaaka/api): ${(e as Error).message}`);
  }
  return dropTestSchemas;
}
