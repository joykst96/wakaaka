// 태그 자동완성 결과와 이름 조회(표기 lint, 태그 정보 호버)의 캐시. 태그 데이터는 가져오기 때만 바뀌므로 페이지가 살아 있는 동안 둔다.
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

/** null: 태그 DB에 없음 */
const known = new Map<string, TagSuggestion | null>();
const listeners = new Set<() => void>();
let version = 0;
let pending = new Set<string>();
const inflight = new Set<string>();
/** tagInfo가 기다리는 이름 → 받을 곳. 조회가 끝나면(실패해도) 부른다 */
const waiters = new Map<string, Array<(info: TagSuggestion | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function settle(name: string) {
  const ws = waiters.get(name);
  if (!ws) return;
  waiters.delete(name);
  const info = known.get(name) ?? null;
  for (const w of ws) w(info);
}

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
        for (const n of chunk) known.set(n, Object.hasOwn(r.tags, n) ? { name: n, ...r.tags[n]! } : null);
        version++;
        for (const l of listeners) l();
      })
      .catch(() => {}) // known에 넣지 않으므로 다음 lint·호버에서 다시 묻는다
      .finally(() => {
        for (const n of chunk) {
          inflight.delete(n);
          settle(n);
        }
      });
  }
}

function request(names: Iterable<string>) {
  for (const n of names) if (!known.has(n) && !inflight.has(n)) pending.add(n);
  if (pending.size > 0 && timer === null) timer = setTimeout(flush, 20);
}

export const tagLookup: TagLookup = { get: (name) => known.get(name), request };

/** 태그 정보 호버(DESIGN 11절): 이름(Danbooru 표기)의 정보. 태그 DB에 없거나 조회에 실패하면 null */
export function tagInfo(name: string): Promise<TagSuggestion | null> {
  const hit = known.get(name);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const ws = waiters.get(name);
    if (ws) ws.push(resolve);
    else waiters.set(name, [resolve]);
    request([name]);
  });
}

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
