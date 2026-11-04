// 마이그레이션. 파일을 동적으로 읽지 않고 여기에 차례로 둔다(빌드 없이 .ts를 바로 돌리므로).
// 이미 적용된 마이그레이션은 고치지 않는다. 바꿀 것이 있으면 다음 번호를 더한다.

import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";

const m0001: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable("owner")
      .addColumn("id", "bigint", (c) => c.primaryKey().generatedAlwaysAsIdentity())
      .addColumn("username", "text", (c) => c.notNull())
      .addColumn("pw_hash", "text", (c) => c.notNull())
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
    await db.schema.createIndex("owner_username_lower").on("owner").unique().expression(sql`lower(username)`).execute();

    await db.schema
      .createTable("session")
      .addColumn("token_hash", "char(64)", (c) => c.primaryKey())
      .addColumn("owner_id", "bigint", (c) => c.notNull().references("owner.id").onDelete("cascade"))
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn("expires_at", "timestamptz", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("session_owner").on("session").column("owner_id").execute();

    await db.schema
      .createTable("wc_content")
      .addColumn("hash", "char(12)", (c) => c.primaryKey())
      .addColumn("doc", "jsonb", (c) => c.notNull())
      .addColumn("size", "integer", (c) => c.notNull())
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createTable("wildcard")
      .addColumn("id", "char(12)", (c) => c.primaryKey())
      .addColumn("owner_id", "bigint", (c) => c.notNull().references("owner.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("latest_seq", "integer", (c) => c.notNull())
      .addColumn("like_count", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("categories", sql`smallint[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
      .addColumn("forked_from_wildcard", "char(12)")
      .addColumn("forked_from_hash", "char(12)")
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn("deleted_at", "timestamptz")
      .execute();
    await db.schema
      .createIndex("wildcard_owner_name_lower")
      .on("wildcard")
      .unique()
      .columns(["owner_id", sql`lower(name)`])
      .where(sql<boolean>`deleted_at is null`)
      .execute();
    await db.schema.createIndex("wildcard_forked_from").on("wildcard").columns(["owner_id", "forked_from_wildcard"]).execute();
    await db.schema.createIndex("wildcard_categories").on("wildcard").using("gin").column("categories").execute();

    await db.schema
      .createTable("wc_version")
      .addColumn("wildcard_id", "char(12)", (c) => c.notNull().references("wildcard.id"))
      .addColumn("seq", "integer", (c) => c.notNull())
      .addColumn("hash", "char(12)", (c) => c.notNull().references("wc_content.hash"))
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint("wc_version_pk", ["wildcard_id", "seq"])
      .execute();
    await db.schema.createIndex("wc_version_hash").on("wc_version").columns(["hash", "wildcard_id"]).execute();

    await db.schema
      .createTable("wc_ref")
      .addColumn("src_hash", "char(12)", (c) => c.notNull().references("wc_content.hash"))
      .addColumn("item_id", "text", (c) => c.notNull())
      .addColumn("target_wildcard_id", "char(12)", (c) => c.notNull().references("wildcard.id"))
      .addPrimaryKeyConstraint("wc_ref_pk", ["src_hash", "item_id", "target_wildcard_id"])
      .execute();
    await db.schema.createIndex("wc_ref_target").on("wc_ref").column("target_wildcard_id").execute();
  },
};

// Phase 3: 즐겨찾기, 좋아요, 둘러보기(이름·설명 검색, 예시 출력).
// pg_trgm은 public에 둔다. 테스트는 스키마마다 search_path가 달라서 연산자 클래스를 public.으로 적는다.
// 테스트는 global-setup이 확장을 미리 만들어 둔다(여러 스키마가 동시에 CREATE EXTENSION을 하면 경합한다).
const m0002: Migration = {
  async up(db: Kysely<any>) {
    await sql`create extension if not exists pg_trgm with schema public`.execute(db);

    await db.schema
      .createTable("favorite")
      .addColumn("owner_id", "bigint", (c) => c.notNull().references("owner.id").onDelete("cascade"))
      .addColumn("wildcard_id", "char(12)", (c) => c.notNull().references("wildcard.id"))
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint("favorite_pk", ["owner_id", "wildcard_id"])
      .execute();

    await db.schema
      .createTable("wc_like")
      .addColumn("owner_id", "bigint", (c) => c.notNull().references("owner.id").onDelete("cascade"))
      .addColumn("wildcard_id", "char(12)", (c) => c.notNull().references("wildcard.id"))
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint("wc_like_pk", ["owner_id", "wildcard_id"])
      .execute();
    await db.schema.createIndex("wc_like_wildcard").on("wc_like").column("wildcard_id").execute();

    // 최신 버전 문서의 description(이름과 같은 방식). 검색용
    await db.schema.alterTable("wildcard").addColumn("description", "text", (c) => c.notNull().defaultTo("")).execute();
    // 둘러보기 카드의 예시 출력. 저장할 때 고정 seed로 계산한다(DESIGN 11절). 전개가 실패하면 null
    await db.schema.alterTable("wildcard").addColumn("example", "text").execute();
    await sql`
      update wildcard w set description = coalesce(c.doc->>'description', '')
      from wc_version v join wc_content c on c.hash = v.hash
      where v.wildcard_id = w.id and v.seq = w.latest_seq
    `.execute(db);

    await sql`create index wildcard_name_trgm on wildcard using gin (name public.gin_trgm_ops)`.execute(db);
    await sql`create index wildcard_description_trgm on wildcard using gin (description public.gin_trgm_ops)`.execute(db);
    await db.schema.createIndex("wildcard_popular").on("wildcard").columns(["like_count desc", "id"]).where(sql<boolean>`deleted_at is null and forked_from_wildcard is null`).execute();
  },
};

// Phase 5: 태그 DB (DESIGN 6절). 데이터는 import-tags.ts가 넣는다. 와일드카드 문서는 태그 ID를 쓰지 않는다.
// name_key·ko_text는 가져오기가 계산해 넣는 검색용 열이다(규칙이 JS 한 곳에 있게, 생성 열로 두지 않음).
// 접두 LIKE는 DB 콜레이션이 C가 아니라서 text_pattern_ops 색인이 있어야 색인을 쓴다.
const m0003: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable("tag")
      .addColumn("id", "integer", (c) => c.primaryKey().generatedAlwaysAsIdentity())
      .addColumn("name", "text", (c) => c.notNull().unique())
      .addColumn("category", "smallint", (c) => c.notNull())
      .addColumn("post_count", "integer", (c) => c.notNull())
      .addColumn("description", "text", (c) => c.notNull())
      .addColumn("body", "text", (c) => c.notNull())
      .addColumn("keywords", sql`text[]`, (c) => c.notNull())
      .addColumn("other_names", sql`text[]`, (c) => c.notNull())
      .addColumn("major_category", "text")
      .addColumn("minor_category", "text")
      .addColumn("is_deprecated", "boolean", (c) => c.notNull().defaultTo(false))
      .addColumn("name_key", "text", (c) => c.notNull())
      .addColumn("ko_text", "text", (c) => c.notNull())
      .execute();
    await sql`create index tag_name_key_prefix on tag (name_key text_pattern_ops)`.execute(db);
    await sql`create index tag_name_key_trgm on tag using gin (name_key public.gin_trgm_ops)`.execute(db);
    await sql`create index tag_ko_trgm on tag using gin (ko_text public.gin_trgm_ops)`.execute(db);
    await db.schema.createIndex("tag_post_count").on("tag").columns(["post_count desc", "id"]).execute();

    await db.schema
      .createTable("tag_keyword")
      .addColumn("tag_id", "integer", (c) => c.notNull().references("tag.id").onDelete("cascade"))
      .addColumn("key", "text", (c) => c.notNull())
      .addColumn("kind", "smallint", (c) => c.notNull())
      .addPrimaryKeyConstraint("tag_keyword_pk", ["tag_id", "key"])
      .execute();
    await sql`create index tag_keyword_key on tag_keyword (key text_pattern_ops, tag_id)`.execute(db);

    // Danbooru active alias. 지금 데이터에는 없어 비어 있다(사용자 결정 2026-11-04). other_names는 넣지 않는다
    await db.schema
      .createTable("tag_alias")
      .addColumn("alias_name", "text", (c) => c.primaryKey())
      .addColumn("tag_id", "integer", (c) => c.notNull().references("tag.id").onDelete("cascade"))
      .execute();

    // 태그 데이터 버전. 마지막 행이 지금 데이터다
    await db.schema
      .createTable("tag_import")
      .addColumn("id", "integer", (c) => c.primaryKey().generatedAlwaysAsIdentity())
      .addColumn("file_name", "text", (c) => c.notNull())
      .addColumn("file_sha256", "char(64)", (c) => c.notNull())
      .addColumn("file_size", "bigint", (c) => c.notNull())
      .addColumn("row_count", "integer", (c) => c.notNull())
      .addColumn("columns", sql`text[]`, (c) => c.notNull())
      .addColumn("stats", "jsonb", (c) => c.notNull())
      .addColumn("imported_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .execute();
  },
};

// Phase 6: 관리자 계정 삭제(DESIGN 9절 "관리"). 아이디 유일 색인은 지운 계정도 포함한 그대로 둔다(다시 가입할 수 없게)
const m0004: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable("owner").addColumn("deleted_at", "timestamptz").execute();
  },
};

export const migrations: Record<string, Migration> = { "0001_init": m0001, "0002_social": m0002, "0003_tags": m0003, "0004_admin": m0004 };

/**
 * schema는 마이그레이션 기록 테이블이 있는 스키마다. 테이블 자체는 연결의 search_path에 만들어진다.
 * 꼭 넘긴다: 넘기지 않으면 Kysely가 기록 테이블을 아무 스키마에서나 찾아서, 다른 스키마에 있으면 만들지 않고 건너뛴다(NOTES).
 */
export async function migrateToLatest(db: Kysely<any>, schema = "public"): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) if (r.status === "Error") console.error(`migration failed: ${r.migrationName}`);
  if (error) throw error;
}
