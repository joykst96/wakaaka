// 태그 자동완성 결과와 표기 lint용 이름 조회의 캐시. 태그 데이터는 가져오기 때만 바뀌므로 페이지가 살아 있는 동안 둔다.
// 이름 조회는 칩 메타(cache.ts)처럼 20ms 모아 200개씩 묻는다(N+1 방지).

import { useSyncExternalStore } from "react";
import { api, type TagSuggestion } from "../lib/api.ts";
import type { TagLookup } from "../editor/tags.ts";

const SUGGEST_CACHE_MAX = 500;
const suggestions = new Map<string, Promise<TagSuggestion[]>>();

/** 같은 q는 한 번만 묻는다. 실패하면 빈 목록이고 다음에 다시 묻는다 */
export function suggestTags(q: string): Promise<TagSuggestion[]> {
  const key = q.trim().replace(/\s+/g, " ").toLowerCase();
  let p = suggestions.get(key);
  if (!p) {
    p = api.tagSuggest(key).then(
      (r) => r.tags,
      () => {
        suggestions.delete(key);
        return [];
      },
    );
    if (suggestions.size >= SUGGEST_CACHE_MAX) suggestions.delete(suggestions.keys().next().value!);
    suggestions.set(key, p);
  }
  return p;
}

type Entry = { category: number } | null;
const known = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let pending = new Set<string>();
const inflight = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const names = [...pending];
  pending = new Set();
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    for (const n of chunk) inflight.add(n);
    api
      .tagLookup(chunk)
      .then((r) => {
        for (const n of chunk) known.set(n, Object.hasOwn(r.tags, n) ? { category: r.tags[n]!.category } : null);
        version++;
        for (const l of listeners) l();
      })
      .catch(() => {}) // known에 넣지 않으므로 다음 lint에서 다시 묻는다
      .finally(() => {
        for (const n of chunk) inflight.delete(n);
      });
  }
}

export const tagLookup: TagLookup = {
  get: (name) => known.get(name),
  request(names) {
    for (const n of names) if (!known.has(n) && !inflight.has(n)) pending.add(n);
    if (pending.size > 0 && timer === null) timer = setTimeout(flush, 20);
  },
};

/** 이름 조회 결과가 도착하면 바뀐다(편집기 lint를 다시 돌리는 데 쓴다) */
export function useTagVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
