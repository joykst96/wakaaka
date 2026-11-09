// 새 CSV(mengod-hf) 기본 와일드카드 일회용 작업의 공통 읽기 (DESIGN 10절 "기본 와일드카드", NOTES 2026-11-09).
// 중간 산출물은 data/defaults-work/(git 무시). 다시 만들어도 같게 나올 필요는 없다(사용자 결정).
import { readFileSync } from "node:fs";
import { descriptionGroup, readTagCsv, type TagRecord } from "../../../apps/api/src/services/tagcsv.ts";

export const CSV = process.env.WAKAAKA_TAGS_CSV ?? "data/danbooru-tags-kr-2026-11-04.csv";
export const WORK = "data/defaults-work";

export interface Tag extends TagRecord {
  major: string | null;
  minor: string | null;
  /** 한 단계 표시 `[표정]`의 글자. 두 단계면 null */
  single: string | null;
}

export function loadTags(): Tag[] {
  const csv = readTagCsv(readFileSync(CSV, "utf8"));
  if (!csv.headerless) throw new Error("expected the headerless mengod-hf CSV");
  return csv.records.map((r) => {
    const g = descriptionGroup(r.description);
    const s = g ? null : (/^\[\s*([^\]>]+?)\s*\]/.exec(r.description)?.[1] ?? null);
    return { ...r, major: g?.major ?? null, minor: g?.minor ?? null, single: s };
  });
}

export const byPopularity = (a: Tag, b: Tag) => b.postCount - a.postCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
/** 사람이 읽을 짧은 설명: 이름(post_count) 본문 앞부분 */
export const brief = (t: Tag, n = 40) => `${t.name}(${t.postCount}) ${t.body.replace(/\s+/g, " ").slice(0, n)}`;
