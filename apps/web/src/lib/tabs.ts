// 편집 화면 탭 목록 (DESIGN 11절 "탭", 사용자 결정 2026-11-03). 순수 함수만 둔다(상태는 app/tabs.tsx).
// 탭 키: 와일드카드 "w:<ID>", 새 와일드카드 "new"(하나뿐). 열린 탭 목록은 localStorage에 기억한다.

import type { KeyValueStore } from "./drafts.ts";
import { isWildcardId, type Route } from "./routes.ts";

export type TabKey = string;
export const MAX_TABS = 30;
const STORE_KEY = "wakaaka:tabs";

export function keyOf(r: Route): TabKey | null {
  if (r.name === "wildcard") return "w:" + r.id;
  if (r.name === "new") return "new";
  return null;
}

export function routeOf(key: TabKey): Route {
  return key === "new" ? { name: "new" } : { name: "wildcard", id: key.slice(2) };
}

export const isTabKey = (k: unknown): k is TabKey => k === "new" || (typeof k === "string" && k.startsWith("w:") && isWildcardId(k.slice(2)));

/**
 * 탭을 연다(이미 있으면 그대로). 상한을 넘으면 맨 앞에서부터 지워도 되는 탭(지금 탭이 아니고 저장 안 한 것도 아닌)을 하나 닫는다.
 */
export function openTab(keys: readonly TabKey[], key: TabKey, keep: (k: TabKey) => boolean = () => false): TabKey[] {
  if (keys.includes(key)) return [...keys];
  const next = [...keys, key];
  if (next.length > MAX_TABS) {
    const drop = next.findIndex((k) => k !== key && !keep(k));
    if (drop >= 0) next.splice(drop, 1);
  }
  return next;
}

/** 탭을 닫고, 닫은 탭이 지금 탭이었으면 옮겨 갈 탭(오른쪽, 없으면 왼쪽, 없으면 null)을 돌려준다 */
export function closeTab(keys: readonly TabKey[], key: TabKey, active: TabKey | null): { keys: TabKey[]; next: TabKey | null } {
  const i = keys.indexOf(key);
  if (i < 0) return { keys: [...keys], next: active };
  const rest = keys.filter((k) => k !== key);
  if (active !== key) return { keys: rest, next: active };
  return { keys: rest, next: rest[i] ?? rest[i - 1] ?? null };
}

/** 탭 키를 바꾼다(새 와일드카드를 저장하면 "new" → "w:<ID>"). 같은 자리를 지키고, 바뀔 키가 이미 있으면 그쪽을 뺀다 */
export function replaceTab(keys: readonly TabKey[], from: TabKey, to: TabKey): TabKey[] {
  const without = keys.filter((k) => k !== to);
  const i = without.indexOf(from);
  if (i < 0) return openTab(without, to);
  without[i] = to;
  return without;
}

/** 탭 순서 바꾸기(끌어서 옮기기) */
export function moveTab(keys: readonly TabKey[], from: number, to: number): TabKey[] {
  const next = [...keys];
  const [k] = next.splice(from, 1);
  if (k === undefined) return [...keys];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, k);
  return next;
}

function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 기억한 탭 목록. 모양이 틀린 값은 버린다 */
export function loadTabs(s: KeyValueStore | null = store()): TabKey[] {
  try {
    const raw = s?.getItem(STORE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter(isTabKey))].slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

export function saveTabs(keys: readonly TabKey[], s: KeyValueStore | null = store()): void {
  try {
    s?.setItem(STORE_KEY, JSON.stringify(keys));
  } catch {}
}
