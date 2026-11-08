// 태그 가져오기, 자동완성, 이름 조회 (DESIGN 6절 "태그 가져오기", 7절 "태그 자동완성").

import { createHash } from "node:crypto";
import { isSafeString, trimSpecWhitespace } from "@wakaaka/core";
import { z } from "zod";
import type { Db } from "../db/connect.ts";
import { ApiError } from "../http.ts";
import { escapeLike } from "../repositories/social.ts";
import * as repo from "../repositories/tags.ts";
import { hasHangul, keywordRows, koKey, koText, nameKey, readTagCsv } from "./tagcsv.ts";

export const SUGGEST_LIMIT = 20;
export const SUGGEST_Q_MAX = 64;
export const LOOKUP_NAMES_MAX = 200;
/** 부분 일치는 이 글자 수부터. pg_trgm은 그보다 짧으면 색인을 못 쓴다(NOTES Phase 5 실측) */
const CONTAINS_MIN = 3;
const BATCH = 5000;

export interface ImportResult {
  skipped: boolean;
  sha256: string;
  rows: number;
  columns: string[];
  unknownColumns: string[];
  stats: Record<string, number>;
}

/**
 * CSV 바이트를 태그 표에 넣는다. 다시 돌려도 된다: 한 트랜잭션에서 비우고 새로 넣는다.
 * 파일 SHA-256이 마지막 가져오기와 같으면 force가 아닐 때 건너뛴다.
 */
export async function importTags(db: Db, x: { fileName: string; bytes: Uint8Array; force?: boolean }): Promise<ImportResult> {
  const sha256 = createHash("sha256").update(x.bytes).digest("hex");
  const last = await repo.lastImport(db);
  if (!x.force && last?.file_sha256 === sha256) {
    return { skipped: true, sha256, rows: last.row_count, columns: last.columns, unknownColumns: [], stats: last.stats };
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(x.bytes); // 잘못된 UTF-8은 TypeError로 멈춘다
  const csv = readTagCsv(text);
  const stats = {
    rows: csv.records.length,
    extraColumnRows: csv.extraColumnRows,
    withKeywords: csv.records.filter((r) => r.keywords.length > 0).length,
    withOtherNames: csv.records.filter((r) => r.otherNames.length > 0).length,
    keywordRows: 0,
  };
  await db.transaction().execute(async (tx) => {
    await repo.truncateTags(tx);
    for (let i = 0; i < csv.records.length; i += BATCH) {
      const chunk = csv.records.slice(i, i + BATCH);
      const ids = await repo.insertTags(
        tx,
        chunk.map((r) => ({ ...r, nameKey: nameKey(r.name), koText: koText(r) })),
      );
      const kws = chunk.flatMap((r) => keywordRows(r).map((k) => ({ tagId: ids.get(r.name)!, postCount: r.postCount, ...k })));
      stats.keywordRows += kws.length;
      for (let j = 0; j < kws.length; j += BATCH) await repo.insertKeywords(tx, kws.slice(j, j + BATCH));
    }
    await repo.insertImport(tx, { fileName: x.fileName, sha256, size: x.bytes.length, rows: csv.records.length, columns: csv.header, stats });
  });
  await repo.analyzeTags(db);
  return { skipped: false, sha256, rows: csv.records.length, columns: csv.header, unknownColumns: csv.unknownColumns, stats };
}

export const suggestQuerySchema = z.strictObject({ q: z.string().max(SUGGEST_Q_MAX * 4) });

export interface TagSuggestion {
  name: string;
  category: number;
  postCount: number;
  body: string;
  keywords: string[];
}

const view = (r: repo.SuggestRow): TagSuggestion => ({ name: r.name, category: r.category, postCount: r.post_count, body: r.body, keywords: r.keywords });

/** q에 한글이 있으면 한국어(키워드·본문), 없으면 영문(이름, 밑줄·공백 무시) */
export async function suggest(db: Db, query: Record<string, string>): Promise<{ tags: TagSuggestion[] }> {
  const r = suggestQuerySchema.safeParse(query);
  if (!r.success) throw new ApiError(400, "E_QUERY", "query does not match the schema");
  if (!isSafeString(r.data.q)) throw new ApiError(400, "E_QUERY", "q contains characters that are not allowed");
  const q = trimSpecWhitespace(r.data.q).replace(/\s+/g, " ").toLowerCase();
  if ([...q].length > SUGGEST_Q_MAX) throw new ApiError(400, "E_QUERY", `q must be at most ${SUGGEST_Q_MAX} characters`);
  if (q === "") return { tags: [] };
  if (hasHangul(q)) {
    const key = koKey(q);
    const contains = [...key].length >= CONTAINS_MIN ? "%" + escapeLike(q) + "%" : null;
    return { tags: (await repo.suggestKorean(db, key, escapeLike(key) + "%", contains, SUGGEST_LIMIT)).map(view) };
  }
  const key = nameKey(q);
  if (key === "") return { tags: [] };
  const long = [...key].length >= CONTAINS_MIN;
  const prefix = escapeLike(key) + "%";
  const rows = await repo.englishPrefix(db, prefix, SUGGEST_LIMIT, long);
  // 접두 일치가 모자랄 때만 부분 일치를 더 찾는다
  if (long && rows.length < SUGGEST_LIMIT) rows.push(...(await repo.englishContains(db, "%" + escapeLike(key) + "%", prefix, SUGGEST_LIMIT - rows.length)));
  return { tags: rows.map(view) };
}

export const lookupBodySchema = z.strictObject({ names: z.array(z.string().min(1).max(256)).max(LOOKUP_NAMES_MAX) });

/** 이름(Danbooru 표기, 밑줄)이 태그 DB에 있는지. 있는 것만 돌려준다 */
export async function lookup(db: Db, names: string[]): Promise<{ tags: Record<string, { category: number; postCount: number }> }> {
  if (!names.every(isSafeString)) throw new ApiError(400, "E_SCHEMA", "names contain characters that are not allowed");
  const rows = await repo.lookupNames(db, [...new Set(names)]);
  // fromEntries는 자기 속성으로 만든다. 이름이 __proto__여도 프로토타입을 바꾸지 않는다
  return { tags: Object.fromEntries(rows.sort((a, b) => (a.name < b.name ? -1 : 1)).map((x) => [x.name, { category: x.category, postCount: x.post_count }])) };
}
