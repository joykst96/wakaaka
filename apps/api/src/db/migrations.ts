// 마이그레이션. 파일을 동적으로 읽지 않고 여기에 차례로 둔다(빌드 없이 .ts를 바로 돌리므로).
// 이미 적용된 마이그레이션은 고치지 않는다. 바꿀 것이 있으면 다음 번호를 더한다.

import { Kysely, sql } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { isFixedDoc, type Doc } from "@wakaaka/core";

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

// 둘러보기에 고친 복사본도 나온다(사용자 결정 2026-11-04). 인기순 부분 색인의 조건을 넓힌다.
// "1번 버전과 해시가 다름"은 하위 쿼리라 색인 조건에 못 넣으므로 latest_seq > 1까지만 넣는다
const m0005: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.dropIndex("wildcard_popular").execute();
    await db.schema
      .createIndex("wildcard_popular")
      .on("wildcard")
      .columns(["like_count desc", "id"])
      .where(sql<boolean>`deleted_at is null and (forked_from_wildcard is null or latest_seq > 1)`)
      .execute();
  },
};

// 한국어 자동완성이 키워드 색인만 읽고 post_count 순으로 고르게 한다(NOTES 2026-11-08 실측: 새 CSV에서 `캐릭터` 266ms → 15ms).
// post_count는 tag의 값을 그대로 옮긴 것이고 가져오기가 함께 넣는다. 이미 있는 행은 여기서 채운다.
const m0006: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable("tag_keyword").addColumn("post_count", "integer", (c) => c.notNull().defaultTo(0)).execute();
    await sql`update tag_keyword k set post_count = t.post_count from tag t where t.id = k.tag_id`.execute(db);
    await db.schema.alterTable("tag_keyword").alterColumn("post_count", (c) => c.dropDefault()).execute();
    await db.schema.dropIndex("tag_keyword_key").execute();
    await sql`create index tag_keyword_key on tag_keyword (key text_pattern_ops, kind, post_count desc, tag_id)`.execute(db);
  },
};

// 사용자 폴더(DESIGN 11절 "폴더", 사용자 결정 2026-11-08). 나만 보는 정리용, 한 단계, 와일드카드마다 폴더 하나.
// 소속은 wildcard.folder_id. FK를 (owner_id, folder_id) 쌍으로 걸어 남의 폴더에 넣는 것을 DB가 막는다.
// 폴더를 지우면 folder_id만 NULL(열 목록 SET NULL, Postgres 15+). owner_id는 NOT NULL이라 열 목록 없이는 지울 수 없다.
const m0007: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable("wc_folder")
      .addColumn("id", "char(12)", (c) => c.primaryKey())
      .addColumn("owner_id", "bigint", (c) => c.notNull().references("owner.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint("wc_folder_owner_id", ["owner_id", "id"])
      .execute();
    await db.schema.createIndex("wc_folder_owner_name_lower").on("wc_folder").unique().columns(["owner_id", sql`lower(name)`]).execute();

    await db.schema.alterTable("wildcard").addColumn("folder_id", "char(12)").execute();
    await sql`
      alter table wildcard add constraint wildcard_folder_fk
      foreign key (owner_id, folder_id) references wc_folder (owner_id, id) on delete set null (folder_id)
    `.execute(db);
    // 폴더를 지울 때 FK가 찾는 색인이자 폴더별 목록 색인
    await db.schema.createIndex("wildcard_folder").on("wildcard").columns(["owner_id", "folder_id"]).where(sql<boolean>`folder_id is not null`).execute();
  },
};

// 폴더 순서를 사용자가 정한다(DESIGN 11절 "폴더", 사용자 결정 2026-11-09: 새 폴더는 우클릭한 곳 바로 아래).
// 기존 폴더는 그때 보이던 순서(listFolders의 ORDER BY name, id, 같은 DB 콜레이션) 그대로 0부터 번호를 매긴다.
// 유일 제약은 DEFERRABLE INITIALLY DEFERRED: 끼워 넣을 때 뒤 폴더들을 한 번에 +1 하는 UPDATE가 행마다 검사에 걸리지 않게.
// 지울 때 빈 번호는 메우지 않는다(순서만 쓰므로 상관없다).
const m0008: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable("wc_folder").addColumn("position", "integer").execute();
    await sql`
      update wc_folder f set position = r.n
      from (select id, (row_number() over (partition by owner_id order by name, id) - 1)::int as n from wc_folder) r
      where r.id = f.id
    `.execute(db);
    await db.schema.alterTable("wc_folder").alterColumn("position", (c) => c.setNotNull()).execute();
    await sql`alter table wc_folder add constraint wc_folder_owner_position unique (owner_id, position) deferrable initially deferred`.execute(db);
  },
};

// 고정 표시(DESIGN 3절 "고정 표시", 사용자 결정 2026-11-09). 최신 버전 문서로 계산해 둔다(목록 쿼리는 문서를 읽지 않는다).
// 판정은 문법 파서가 필요해 SQL로 못 하므로 이미 있는 행은 여기서 core isFixedDoc으로 채운다. 지운 와일드카드도 채운다.
// 1,000개씩 ID 순으로 끊어 읽는다. 마이그레이션 코드는 고치지 않으므로 판정이 바뀌면 다음 번호로 다시 채운다.
const m0009: Migration = {
  async up(db: Kysely<any>) {
    await db.schema.alterTable("wildcard").addColumn("fixed", "boolean", (c) => c.notNull().defaultTo(false)).execute();
    let after = "";
    for (;;) {
      const rows = await db
        .selectFrom("wildcard as w")
        .innerJoin("wc_version as v", (j) => j.onRef("v.wildcard_id", "=", "w.id").onRef("v.seq", "=", "w.latest_seq"))
        .innerJoin("wc_content as c", "c.hash", "v.hash")
        .select(["w.id", "c.doc"])
        .where("w.id", ">", after)
        .orderBy("w.id")
        .limit(1000)
        .execute();
      if (rows.length === 0) break;
      const fixed = rows.filter((r) => isFixedDoc(r.doc as Doc)).map((r) => r.id as string);
      if (fixed.length > 0) await db.updateTable("wildcard").set({ fixed: true }).where("id", "in", fixed).execute();
      after = rows[rows.length - 1]!.id as string;
    }
  },
};

// 성인 분류 14(DESIGN 3절, 10절 "기본 와일드카드", 사용자 요청 2026-11-12). 이미 넣은 기본 와일드카드 중
// 전용 계정 wakaaka의 `성인 > ` 이름에 14를 더한다(생성기 04-build.ts와 같은 결과 [11, 14]). 지운 것도 바꾼다.
// 이미 14가 있으면 건너뛰어 여러 번 돌려도 같다. 남이 가져간 복사본은 그 사람 것이라 건드리지 않는다.
// 트리거가 아니라 DB마다 한 번 도는 UPDATE다(kysely_migration에 기록). 그 뒤에 `성인 > ` 이름으로 저장하는 것에는
// 붙지 않고, 저장 요청의 분류를 그대로 쓴다. 빈 DB에서는 바꿀 행이 없고, 그 뒤 seed는 생성기가 붙인 [11, 14]를 넣는다.
const m0010: Migration = {
  async up(db: Kysely<any>) {
    await sql`
      update wildcard w
      set categories = array(select distinct c from unnest(w.categories || 14::smallint) c order by c)
      from owner o
      where o.id = w.owner_id and lower(o.username) = 'wakaaka' and w.name like '성인 > %' and not (14::smallint = any (w.categories))
    `.execute(db);
  },
};

export const migrations: Record<string, Migration> = {
  "0001_init": m0001,
  "0002_social": m0002,
  "0003_tags": m0003,
  "0004_admin": m0004,
  "0005_explore_edited_copies": m0005,
  "0006_tag_keyword_post_count": m0006,
  "0007_folders": m0007,
  "0008_folder_position": m0008,
  "0009_fixed": m0009,
  "0010_adult_category": m0010,
};

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
