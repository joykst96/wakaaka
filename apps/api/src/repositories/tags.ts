// 태그 DB SQL (DESIGN 6절, 7절 "태그 자동완성"). 모든 값은 바인딩한다. LIKE 패턴은 서비스가 이스케이프해서 넘긴다.
// 접두 패턴은 매개변수 그대로 LIKE에 넘긴다. CTE의 값으로 넘기면 플래너가 접두 색인을 못 쓴다(NOTES Phase 5 실측).

import { sql } from "kysely";
import type { Db } from "../db/connect.ts";

export interface TagInsert {
  name: string;
  category: number;
  postCount: number;
  description: string;
  body: string;
  keywords: string[];
  otherNames: string[];
  majorCategory: string | null;
  minorCategory: string | null;
  nameKey: string;
  koText: string;
}

/** 배열 안의 배열은 unnest가 펼쳐 버리므로 U+001F로 이어 보낸다. 가져오기가 C0 제어문자를 거부하므로 겹치지 않는다 */
const US = "\x1f";

export async function lastImport(db: Db) {
  return db.selectFrom("tag_import").selectAll().orderBy("id", "desc").limit(1).executeTakeFirst();
}

export async function truncateTags(db: Db): Promise<void> {
  await sql`truncate tag_alias, tag_keyword, tag`.execute(db);
}

/** 한 묶음을 넣고 이름 → id */
export async function insertTags(db: Db, rows: readonly TagInsert[]): Promise<Map<string, number>> {
  const col = <T>(f: (r: TagInsert) => T) => rows.map(f);
  const r = await sql<{ id: number; name: string }>`
    insert into tag (name, category, post_count, description, body, keywords, other_names, major_category, minor_category, name_key, ko_text)
    select name, category, post_count, description, body, string_to_array(keywords, ${US}), string_to_array(other_names, ${US}),
           major_category, minor_category, name_key, ko_text
    from unnest(${col((x) => x.name)}::text[], ${col((x) => x.category)}::smallint[], ${col((x) => x.postCount)}::int[],
                ${col((x) => x.description)}::text[], ${col((x) => x.body)}::text[], ${col((x) => x.keywords.join(US))}::text[],
                ${col((x) => x.otherNames.join(US))}::text[], ${col((x) => x.majorCategory)}::text[], ${col((x) => x.minorCategory)}::text[],
                ${col((x) => x.nameKey)}::text[], ${col((x) => x.koText)}::text[])
         as t(name, category, post_count, description, body, keywords, other_names, major_category, minor_category, name_key, ko_text)
    returning id, name`.execute(db);
  return new Map(r.rows.map((x) => [x.name, x.id]));
}

export async function insertKeywords(db: Db, rows: ReadonlyArray<{ tagId: number; key: string; kind: number }>): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    insert into tag_keyword (tag_id, key, kind)
    select * from unnest(${rows.map((x) => x.tagId)}::int[], ${rows.map((x) => x.key)}::text[], ${rows.map((x) => x.kind)}::smallint[])`.execute(db);
}

export async function insertImport(db: Db, x: { fileName: string; sha256: string; size: number; rows: number; columns: string[]; stats: Record<string, number> }) {
  return db
    .insertInto("tag_import")
    .values({ file_name: x.fileName, file_sha256: x.sha256, file_size: x.size, row_count: x.rows, columns: x.columns, stats: JSON.stringify(x.stats) })
    .returning(["id", "imported_at"])
    .executeTakeFirstOrThrow();
}

export async function analyzeTags(db: Db): Promise<void> {
  await sql`analyze tag`.execute(db);
  await sql`analyze tag_keyword`.execute(db);
}

export interface SuggestRow {
  name: string;
  category: number;
  post_count: number;
  body: string;
  keywords: string[];
}

const COLS = sql`t.name, t.category, t.post_count, left(t.body, ${200}) as body, t.keywords`;

/**
 * 영문 접두 일치를 post_count 순으로. fenced면 먼저 접두 색인으로 후보를 다 고른 뒤 정렬한다(`offset 0`이 하위 질의를 펼치지 못하게 막는다).
 * 실측(NOTES Phase 5): 짧은 접두는 후보가 많아 post_count 색인을 따라가는 편이 빠르고(0.1ms, 울타리면 11~15ms),
 * 긴 접두는 계획기가 후보 수를 많게 잡아 post_count 색인을 끝까지 훑는다(`hatsunem` 18ms, 울타리면 0.4ms).
 */
export async function englishPrefix(db: Db, prefix: string, limit: number, fenced: boolean): Promise<SuggestRow[]> {
  const from = fenced ? sql`(select * from tag where name_key like ${prefix} offset 0) t` : sql`tag t where t.name_key like ${prefix}`;
  return (await sql<SuggestRow>`select ${COLS} from ${from} order by t.post_count desc, t.id limit ${limit}`.execute(db)).rows;
}

/** 영문 부분 일치(접두 일치 제외). 늘 울타리를 친다: 울타리가 없으면 계획기가 post_count 색인을 끝까지 훑을 수 있다(30ms, 울타리면 3글자 최악 11ms) */
export async function englishContains(db: Db, contains: string, prefix: string, limit: number): Promise<SuggestRow[]> {
  const r = await sql<SuggestRow>`
    select ${COLS} from (select * from tag where name_key like ${contains} offset 0) t
    where t.name_key not like ${prefix} order by t.post_count desc, t.id limit ${limit}`.execute(db);
  return r.rows;
}

/**
 * 한국어: 키워드 전체가 같음(0) → 키워드 접두(1) → 키워드 낱말 접두(2) → 키워드·본문 부분 일치(3, contains가 null이면 안 함).
 * key는 공백을 뺀 검색어, prefix는 key의 접두 패턴.
 */
export async function suggestKorean(db: Db, key: string, prefix: string, contains: string | null, limit: number): Promise<SuggestRow[]> {
  const kw = sql`select k.tag_id, min(case when k.kind = 0 and k.key = ${key} then 0 when k.kind = 0 then 1 else 2 end) as tier
                 from tag_keyword k where k.key like ${prefix} group by k.tag_id`;
  const all = contains === null ? kw : sql`${kw} union all select t.id, 3 from tag t where t.ko_text like ${contains}`;
  const r = await sql<SuggestRow>`
    with m as (select tag_id, min(tier) as tier from (${all}) u group by tag_id)
    select ${COLS} from m join tag t on t.id = m.tag_id order by m.tier, t.post_count desc, t.id limit ${limit}`.execute(db);
  return r.rows;
}

export async function lookupNames(db: Db, names: readonly string[]) {
  if (names.length === 0) return [];
  return db.selectFrom("tag").select(["name", "category", "post_count"]).where("name", "in", [...names]).execute();
}
