// 폴더 묶기와 이름 검사 (DESIGN 11절 "폴더"). 사이드바와 폴더 정리 화면이 같이 쓴다. 화면 없이 테스트한다.

import type { Folder } from "./api.ts";
import type { KeyValueStore } from "./drafts.ts";

const COLLAPSED_KEY = "wakaaka:folders-collapsed";

function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 사이드바에서 접은 폴더 ID. 이 브라우저에만 기억한다. 읽지 못하면 모두 펼친 것으로 본다 */
export function loadCollapsed(s: KeyValueStore | null = store()): Set<string> {
  try {
    const v = JSON.parse(s?.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9A-Za-z]{12}$/.test(x)) : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsed(ids: ReadonlySet<string>, s: KeyValueStore | null = store()): void {
  try {
    if (ids.size === 0) s?.removeItem(COLLAPSED_KEY);
    else s?.setItem(COLLAPSED_KEY, JSON.stringify([...ids].sort()));
  } catch {}
}

/** API의 규칙과 같다(apps/api services/folders.ts) */
export const FOLDER_NAME_MAX = 64;

export interface Grouped<T> {
  /** 서버가 준 순서(이름순) 그대로. 든 것이 없는 폴더도 나온다 */
  folders: Array<{ folder: Folder; items: T[] }>;
  /** "폴더 없음" */
  loose: T[];
}

/**
 * 내 목록을 폴더별로 나눈다. 폴더 안의 순서는 list 순서(이름순)를 지킨다.
 * 폴더에 있다고 나온 ID가 list에 없으면(지웠거나 아직 목록을 다시 받지 않음) 건너뛴다.
 */
export function groupByFolder<T extends { id: string }>(list: readonly T[], folders: readonly Folder[]): Grouped<T> {
  const where = new Map<string, string>();
  for (const f of folders) for (const id of f.wildcards) where.set(id, f.id);
  const items = new Map<string, T[]>(folders.map((f) => [f.id, []]));
  const loose: T[] = [];
  for (const w of list) {
    const f = where.get(w.id);
    const bucket = f === undefined ? undefined : items.get(f);
    if (bucket) bucket.push(w);
    else loose.push(w);
  }
  return { folders: folders.map((f) => ({ folder: f, items: items.get(f.id)! })), loose };
}

/** 와일드카드 ID → 폴더 */
export function folderIndex(folders: readonly Folder[]): Map<string, Folder> {
  const m = new Map<string, Folder>();
  for (const f of folders) for (const id of f.wildcards) m.set(id, f);
  return m;
}

/**
 * 입력한 폴더 이름을 보낼 모양으로. 앞뒤 공백은 지워 준다(서버는 거부하므로).
 * 문제가 있으면 { error }. 겹침은 서버도 보지만 미리 알려 준다(대소문자 무시, except는 이름을 바꾸는 폴더 자신)
 */
export function checkFolderName(input: string, folders: readonly Folder[], except?: string): { name: string } | { error: string } {
  const name = input.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
  if (name === "") return { error: "이름을 적어 주세요." };
  if (/[\u0000-\u001f\u007f]/.test(name) || !name.isWellFormed()) return { error: "이름에 쓸 수 없는 글자가 있습니다." };
  if ([...name].length > FOLDER_NAME_MAX) return { error: `이름은 ${FOLDER_NAME_MAX}자까지입니다.` };
  const key = name.toLowerCase();
  if (folders.some((f) => f.id !== except && f.name.toLowerCase() === key)) return { error: "같은 이름의 폴더가 있습니다." };
  return { name };
}
