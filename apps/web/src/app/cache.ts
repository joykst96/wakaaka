// 칩 메타데이터와 하위 묶음의 캐시. 여러 화면과 편집기 칸이 같은 ID를 물어도 요청은 한 번(lookup은 묶어서) 간다.
// 저장·가져오기 뒤에는 invalidate로 비운다.

import { expand } from "@wakaaka/core";
import { useEffect, useSyncExternalStore } from "react";
import { api, type Card } from "../lib/api.ts";
import type { BundleLike } from "../lib/preview.ts";

type MetaEntry = Card | null; // null = 없음(지웠거나 남의 것이 아닌데 없는 ID)

const meta = new Map<string, MetaEntry>();
const bundles = new Map<string, Promise<BundleLike | null>>();
const listeners = new Set<() => void>();
let version = 0;
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  version++;
  for (const l of listeners) l();
}

function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    api
      .lookup(chunk)
      .then((r) => {
        for (const id of chunk) meta.set(id, r.wildcards[id] ?? null);
        emit();
      })
      .catch(() => {
        // 다음에 다시 묻게 비워 둔다
        for (const id of chunk) meta.delete(id);
      });
  }
}

/** 메타를 요청해 둔다(이미 있거나 요청 중이면 그대로) */
export function requestMeta(ids: Iterable<string>): void {
  for (const id of ids) {
    if (meta.has(id) || pending.has(id)) continue;
    pending.add(id);
  }
  if (pending.size > 0 && timer === null) timer = setTimeout(flush, 20);
}

export function getMeta(id: string): MetaEntry | undefined {
  return meta.get(id);
}

/** 이미 받은 카드를 넣는다(목록 화면에서 받은 것 재사용) */
export function primeMeta(cards: Iterable<Card>): void {
  for (const c of cards) meta.set(c.id, c);
  emit();
}

export function useMetaVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** ids의 메타를 요청하고, 도착하면 다시 그린다 */
export function useMeta(ids: readonly string[]): (id: string) => MetaEntry | undefined {
  useMetaVersion();
  const key = ids.join(",");
  useEffect(() => requestMeta(ids), [key]); // eslint 없음: key가 ids의 내용이다
  return getMeta;
}

/** 와일드카드의 최신 닫힌 묶음. 없거나 실패하면 null */
export function getBundle(id: string, version?: number): Promise<BundleLike | null> {
  const key = `${id}@${version ?? "?"}`;
  let p = bundles.get(key);
  if (!p) {
    p = api.bundle(id).catch(() => null);
    bundles.set(key, p);
  }
  return p;
}

/** 칩 미리보기: 예시 출력 3개(seed 0, 1, 2) */
export async function examplesOf(id: string, version?: number): Promise<string[]> {
  const b = await getBundle(id, version);
  if (!b) return [];
  return [0, 1, 2].map((s) => {
    const r = expand(b, BigInt(s), { rootWildcard: id });
    return r.ok ? r.text : `(${r.error.code})`;
  });
}

export function invalidate(ids?: Iterable<string>): void {
  if (ids === undefined) {
    meta.clear();
    bundles.clear();
  } else {
    for (const id of ids) meta.delete(id);
    // 묶음은 하위가 바뀌어도 위쪽 묶음이 낡으므로 모두 비운다
    bundles.clear();
  }
  emit();
}
