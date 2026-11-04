import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./types.ts";

export type Db = Kysely<DB>;

/** searchPath는 테스트가 스키마를 따로 쓸 때만 준다. 이름은 테스트 코드가 만든 값이고 사용자 입력이 아니다. */
export function createDb(url: string, options: { searchPath?: string; max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}),
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
