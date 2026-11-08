// 폴더 묶기와 이름 검사 (DESIGN 11절 "폴더"). 사이드바와 폴더 정리 화면이 같이 쓴다. 화면 없이 테스트한다.

import { ApiError, type Folder } from "./api.ts";
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
  /** 서버가 준 순서(사용자가 정한 순서, 0008) 그대로. 든 것이 없는 폴더도 나온다 */
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

// ---------------- 우클릭 메뉴와 끌어 놓기 (사용자 결정 2026-11-09, DESIGN 11절 "우클릭 메뉴", "끌어 놓기") ----------------

/** 우클릭한 곳. folder: 폴더(사이드바 폴더 머리, 폴더 칩), wildcard: 와일드카드 행, end: "폴더 없음"·"전체"·빈 곳 */
export type MenuTarget = { kind: "folder"; id: string } | { kind: "wildcard"; id: string } | { kind: "end" };

/** 화면 요소의 data-folder-menu 값("folder:ID", "wildcard:ID", "end")을 읽는다. 모르는 값이면 null */
export function parseMenuTarget(v: string | null | undefined): MenuTarget | null {
  if (v === "end") return { kind: "end" };
  const m = /^(folder|wildcard):([0-9A-Za-z]{12})$/.exec(v ?? "");
  return m ? { kind: m[1] as "folder" | "wildcard", id: m[2]! } : null;
}

/**
 * 새 폴더가 들어갈 자리. 우클릭한 곳 바로 아래(관례): 폴더면 그 폴더 다음, 폴더 안의 와일드카드면 그 폴더 다음
 * (한 단계라 와일드카드 사이에는 못 둔다), 나머지는 맨 끝(undefined). 서버 POST /api/folders의 after와 같다
 */
export function newFolderAfter(target: MenuTarget, folders: readonly Folder[]): string | undefined {
  if (target.kind === "folder") return folders.some((f) => f.id === target.id) ? target.id : undefined;
  if (target.kind === "wildcard") return folderIndex(folders).get(target.id)?.id;
  return undefined;
}

/** 지우기 확인 문구에 쓰는 수: 폴더에 든 지우지 않은 와일드카드(서버 목록 기준. "가져온 것 숨기기"로 감춘 것도 센다) */
export function folderCount(folder: Folder): number {
  return folder.wildcards.length;
}

/** 놓은 곳의 data-drop 값: 폴더 ID 또는 "none"(폴더 없음). 모르는 값이면 undefined */
export function parseDropTarget(v: string | null | undefined): string | null | undefined {
  if (v === "none") return null;
  return v && /^[0-9A-Za-z]{12}$/.test(v) ? v : undefined;
}

/** 끄는 것: 고른 것 중 하나를 끌면 고른 것 전부(보이는 순서), 아니면 그것 하나 */
export function dragSet(id: string, selected: ReadonlySet<string>, shown: readonly string[]): string[] {
  return selected.has(id) ? shown.filter((x) => selected.has(x)) : [id];
}

/** 실제로 옮길 것: 이미 target(null = 폴더 없음)에 있는 것은 뺀다. 비면 요청하지 않는다 */
export function needsMove(ids: readonly string[], target: string | null, folders: readonly Folder[]): string[] {
  const index = folderIndex(folders);
  return [...new Set(ids)].filter((id) => (index.get(id)?.id ?? null) !== target);
}

/** 옮기기를 화면에 먼저 반영한 폴더 목록. ids를 모든 폴더에서 빼고 target(null = 폴더 없음)에 넣는다. 실패하면 부르는 쪽이 이전 목록으로 되돌린다 */
export function moveLocally(folders: readonly Folder[], ids: readonly string[], target: string | null): Folder[] {
  const set = new Set(ids);
  return folders.map((f) => {
    const kept = f.wildcards.filter((id) => !set.has(id));
    if (f.id === target) return { ...f, wildcards: [...kept, ...ids.filter((id) => !kept.includes(id))] };
    return kept.length === f.wildcards.length ? f : { ...f, wildcards: kept };
  });
}

/** 오류 코드를 화면 문구로. 폴더 정리 화면과 사이드바가 같이 쓴다 */
export function folderErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case "E_FOLDER_NAME_TAKEN":
      return "같은 이름의 폴더가 있습니다.";
    case "E_FOLDER_LIMIT":
      return "폴더는 100개까지 만들 수 있습니다.";
    case "E_FOLDER_NAME":
      return "폴더 이름은 앞뒤 공백 없이 1~64자이고 줄바꿈 같은 제어문자는 쓸 수 없습니다.";
    case "E_FOLDER_NOT_FOUND":
      return "폴더가 없습니다. 다른 곳에서 지웠을 수 있습니다.";
    case "E_NOT_FOUND":
      return "지운 와일드카드가 섞여 있습니다. 목록을 새로 받았으니 다시 골라 주세요.";
    default:
      return e.message;
  }
}
