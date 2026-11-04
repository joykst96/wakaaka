// 태그 CSV 읽기 (DESIGN 6절 "태그 가져오기"). DB와 무관한 순수 함수라 단위 테스트로 본다.
// 열 이름으로 읽는다. 지금 danbooru-tags.csv는 헤더가 4열인데 뒤쪽 행이 이름 없는 다섯째 열(위키 other_names)을 가진다(NOTES Phase 5).

import { isSafeString } from "@wakaaka/core";

export const REQUIRED_COLUMNS = ["name", "category", "post_count"] as const;
export const OPTIONAL_COLUMNS = ["description", "major_category", "minor_category", "keywords", "other_names"] as const;
type Column = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

/** Danbooru 기본 타입 번호(DATA_SCHEMA): general 0, artist 1, copyright 3, character 4, meta 5 */
export const TAG_CATEGORIES = [0, 1, 3, 4, 5] as const;
const NAME_MAX = 256;
const TEXT_MAX = 20_000;

export class TagCsvError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

export interface TagRecord {
  name: string;
  category: number;
  postCount: number;
  /** CSV 원문 그대로 */
  description: string;
  /** 설명에서 맨 앞 `[대분류 > 소분류]`와 끝의 `키워드: …`를 뗀 본문 */
  body: string;
  keywords: string[];
  otherNames: string[];
  majorCategory: string | null;
  minorCategory: string | null;
}

export interface TagCsv {
  /** 헤더에 적힌 열 이름 그대로 */
  header: string[];
  /** 쓰지 않은(모르는) 열 이름 */
  unknownColumns: string[];
  /** 헤더에 other_names가 없고 한 칸 더 있어서 그 칸을 other_names로 읽은 행 수 */
  extraColumnRows: number;
  records: TagRecord[];
}

/** RFC 4180 CSV. 줄 끝은 CRLF와 LF 모두, 맨 앞 BOM은 뗀다. 필드 안 줄바꿈은 따옴표 안에서만 */
export function* parseCsv(text: string): Generator<{ line: number; fields: string[] }> {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const start = line;
    const fields: string[] = [];
    for (;;) {
      let f = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) throw new TagCsvError(start, "unterminated quoted field");
          const c = text[i]!;
          if (c === '"') {
            if (text[i + 1] === '"') {
              f += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (c === "\n") line++;
          f += c;
          i++;
        }
        if (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) throw new TagCsvError(line, "text after closing quote");
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          if (text[i] === '"') throw new TagCsvError(line, "quote inside an unquoted field");
          f += text[i];
          i++;
        }
      }
      fields.push(f);
      if (i >= n) break;
      if (text[i] === ",") {
        i++;
        continue;
      }
      i += text[i] === "\r" ? 2 : 1;
      line++;
      break;
    }
    yield { line: start, fields };
  }
}

const DESC = /^\[([^\]>]+?) > ([^\]]+)\]\s*/;
const KEYWORDS = "키워드:";

/** 설명 맨 앞의 `[대분류 > 소분류]`(예전 체계). 없으면 null. 기본 와일드카드 생성기가 묶는 데 쓴다(DESIGN 10절) */
export function descriptionGroup(description: string): { major: string; minor: string } | null {
  const m = DESC.exec(description);
  return m ? { major: m[1]!.trim(), minor: m[2]!.trim() } : null;
}

/** 설명 → 본문과 키워드. `[대분류 > 소분류]`는 예전 체계라 분류 열로 쓰지 않고 본문에서 떼기만 한다(DESIGN 6절) */
export function splitDescription(description: string): { body: string; keywords: string[] } {
  let body = description;
  const m = DESC.exec(body);
  if (m) body = body.slice(m[0].length);
  let keywords: string[] = [];
  const k = body.lastIndexOf(KEYWORDS);
  if (k >= 0) {
    keywords = splitList(body.slice(k + KEYWORDS.length), ",");
    body = body.slice(0, k);
  }
  return { body: body.trim(), keywords };
}

function splitList(s: string, sep: string): string[] {
  return [...new Set(s.split(sep).map((x) => x.trim()).filter((x) => x !== ""))];
}

export function readTagCsv(text: string): TagCsv {
  const rows = parseCsv(text);
  const first = rows.next();
  if (first.done) throw new TagCsvError(1, "empty file");
  const header = first.value.fields.map((h) => h.trim());
  const index = new Map<Column, number>();
  const unknownColumns: string[] = [];
  header.forEach((h, j) => {
    if ((REQUIRED_COLUMNS as readonly string[]).includes(h) || (OPTIONAL_COLUMNS as readonly string[]).includes(h)) {
      if (index.has(h as Column)) throw new TagCsvError(1, `duplicate column ${h}`);
      index.set(h as Column, j);
    } else unknownColumns.push(h);
  });
  for (const c of REQUIRED_COLUMNS) if (!index.has(c)) throw new TagCsvError(1, `missing column ${c}`);
  // 헤더 없는 다섯째 열 → other_names (헤더에 other_names가 없을 때만)
  const extraIndex = index.has("other_names") ? null : header.length;

  const names = new Set<string>();
  const records: TagRecord[] = [];
  let extraColumnRows = 0;
  for (const { line, fields } of rows) {
    if (fields.length === 1 && fields[0] === "") continue; // 빈 줄
    let extra: string | null = null;
    if (fields.length === header.length + 1 && extraIndex !== null) {
      extra = fields[extraIndex]!;
      extraColumnRows++;
    } else if (fields.length !== header.length) throw new TagCsvError(line, `expected ${header.length} fields, got ${fields.length}`);
    for (const f of fields) {
      if (!isSafeString(f)) throw new TagCsvError(line, "field contains characters that are not allowed");
      if (f.length > TEXT_MAX) throw new TagCsvError(line, "field is too long");
    }
    const get = (c: Column) => (index.has(c) ? fields[index.get(c)!]! : "");

    const name = get("name");
    if (name === "" || name.length > NAME_MAX || /\s/.test(name)) throw new TagCsvError(line, `bad tag name ${JSON.stringify(name)}`);
    if (names.has(name)) throw new TagCsvError(line, `duplicate tag name ${name}`);
    names.add(name);
    const category = Number(get("category"));
    if (!/^[0-9]$/.test(get("category")) || !(TAG_CATEGORIES as readonly number[]).includes(category)) throw new TagCsvError(line, `bad category ${get("category")}`);
    if (!/^[0-9]{1,10}$/.test(get("post_count")) || Number(get("post_count")) > 2 ** 31 - 1) throw new TagCsvError(line, `bad post_count ${get("post_count")}`);

    const description = get("description");
    const split = splitDescription(description);
    const keywords = index.has("keywords") ? splitList(get("keywords"), ",") : split.keywords;
    const other = index.has("other_names") ? get("other_names") : (extra ?? "");
    const major = get("major_category").trim();
    const minor = get("minor_category").trim();
    records.push({
      name,
      category,
      postCount: Number(get("post_count")),
      description,
      body: split.body,
      keywords,
      otherNames: splitList(other, "|"),
      majorCategory: major === "" ? null : major,
      minorCategory: minor === "" ? null : minor,
    });
  }
  return { header, unknownColumns, extraColumnRows, records };
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
export const hasHangul = (s: string) => HANGUL.test(s);

/** 영문 검색 키: 밑줄·공백을 빼고 소문자 (DESIGN 7절 "태그 자동완성") */
export const nameKey = (s: string) => s.replace(/[_\s]/g, "").toLowerCase();
/** 한국어 검색 키: 공백을 빼고 소문자 */
export const koKey = (s: string) => s.replace(/\s/g, "").toLowerCase();

/** 한국어 검색에 쓰는 이름들: 키워드와 한글이 든 other_names */
export function koNames(r: TagRecord): string[] {
  return [...r.keywords, ...r.otherNames.filter(hasHangul).map((o) => o.replaceAll("_", " "))];
}

/**
 * 한국어 접두 검색 표(tag_keyword)의 행. kind 0: 이름 전체(공백 제거), kind 1: 공백으로 나눈 낱말.
 * 같은 태그 안에서 겹치는 키는 한 번만, kind 0이 이긴다.
 */
export function keywordRows(r: TagRecord): Array<{ key: string; kind: 0 | 1 }> {
  const out = new Map<string, 0 | 1>();
  const names = koNames(r);
  for (const k of names) {
    const key = koKey(k);
    if (key !== "") out.set(key, 0);
  }
  for (const k of names) {
    const words = k.trim().split(/\s+/);
    if (words.length < 2) continue;
    for (const w of words) {
      const key = w.toLowerCase();
      if (key !== "" && !out.has(key)) out.set(key, 1);
    }
  }
  return [...out].map(([key, kind]) => ({ key, kind }));
}

/** 한국어 부분 일치용 글: 한국어 이름들과 한글이 든 본문. 영어 위키 본문은 넣지 않는다(색인만 커짐) */
export function koText(r: TagRecord): string {
  const parts = koNames(r);
  if (hasHangul(r.body)) parts.push(r.body);
  return parts.join("\n").toLowerCase();
}
