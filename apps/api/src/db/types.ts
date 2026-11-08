// Kysely 테이블 타입 (DESIGN 6절). 마이그레이션은 migrations.ts.

import type { ColumnType, Generated, JSONColumnType } from "kysely";
import type { Doc } from "@wakaaka/core";

export interface OwnerTable {
  /** bigint identity. pg는 int8을 문자열로 돌려준다 */
  id: Generated<string>;
  username: string;
  pw_hash: string;
  created_at: Generated<Date>;
  /** 관리자 계정 삭제(Phase 6). 지운 계정은 로그인·세션·사용자 페이지에서 없는 것과 같다 */
  deleted_at: ColumnType<Date | null, never, Date | null>;
}

export interface SessionTable {
  /** 쿠키 토큰의 sha256 (16진수 64자). 토큰 자체는 저장하지 않는다 */
  token_hash: string;
  owner_id: string;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface WcContentTable {
  hash: string;
  /** 넣을 때는 정규화(JCS)한 JSON 문자열, 읽을 때는 pg가 파싱한 객체 */
  doc: JSONColumnType<Doc, string, never>;
  /** 정규화 JSON의 UTF-8 바이트 수 */
  size: number;
  created_at: Generated<Date>;
}

export interface WildcardTable {
  id: string;
  owner_id: string;
  name: string;
  latest_seq: number;
  like_count: Generated<number>;
  categories: ColumnType<number[], number[], number[]>;
  forked_from_wildcard: string | null;
  forked_from_hash: string | null;
  /** 최신 버전 문서의 description (없으면 "") */
  description: Generated<string>;
  /** 둘러보기 예시 출력. 전개가 실패하면 null */
  example: ColumnType<string | null, string | null | undefined, string | null>;
  /** 0007. 나만 보는 폴더(DESIGN 11절 "폴더"). NULL = 폴더 없음. 공개 응답에는 넣지 않는다 */
  folder_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface WcFolderTable {
  id: string;
  owner_id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface WcVersionTable {
  wildcard_id: string;
  seq: number;
  hash: string;
  created_at: Generated<Date>;
}

export interface WcRefTable {
  src_hash: string;
  item_id: string;
  target_wildcard_id: string;
}

export interface FavoriteTable {
  owner_id: string;
  wildcard_id: string;
  created_at: Generated<Date>;
}

export interface WcLikeTable {
  owner_id: string;
  wildcard_id: string;
  created_at: Generated<Date>;
}

export interface TagTable {
  id: Generated<number>;
  name: string;
  /** Danbooru 기본 타입 0 general, 1 artist, 3 copyright, 4 character, 5 meta */
  category: number;
  post_count: number;
  description: string;
  body: string;
  keywords: string[];
  other_names: string[];
  major_category: string | null;
  minor_category: string | null;
  is_deprecated: Generated<boolean>;
  name_key: string;
  ko_text: string;
}

export interface TagKeywordTable {
  tag_id: number;
  key: string;
  kind: number;
}

export interface TagAliasTable {
  alias_name: string;
  tag_id: number;
}

export interface TagImportTable {
  id: Generated<number>;
  file_name: string;
  file_sha256: string;
  /** bigint. pg는 int8을 문자열로 돌려준다 */
  file_size: ColumnType<string, number, never>;
  row_count: number;
  columns: string[];
  stats: JSONColumnType<Record<string, number>, string, never>;
  imported_at: Generated<Date>;
}

export interface DB {
  tag: TagTable;
  tag_keyword: TagKeywordTable;
  tag_alias: TagAliasTable;
  tag_import: TagImportTable;
  owner: OwnerTable;
  session: SessionTable;
  wc_content: WcContentTable;
  wildcard: WildcardTable;
  wc_version: WcVersionTable;
  wc_ref: WcRefTable;
  favorite: FavoriteTable;
  wc_like: WcLikeTable;
  wc_folder: WcFolderTable;
}
