// 저장 안 한 편집 내용의 임시 보관 (DESIGN 11절). localStorage에 와일드카드마다 하나.
// localStorage를 고른 이유(NOTES Phase 3): 탭을 닫거나 브라우저가 죽어도 남아야 한다(sessionStorage는 탭과 함께 사라진다).
// 이 브라우저에만 남고 서버로 가지 않는다. 사생활 보호 창 등에서 접근이 막히면 조용히 건너뛴다.

import type { EditDoc } from "./editdoc.ts";

const PREFIX = "wakaaka:draft:";

export interface Draft {
  /** 편집을 시작할 때의 최신 버전 해시. 새 와일드카드는 null */
  baseHash: string | null;
  savedAt: string;
  doc: EditDoc;
  categories: number[];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** key: 와일드카드 ID, 새 와일드카드는 "new" */
export function loadDraft(key: string, s: KeyValueStore | null = store()): Draft | null {
  try {
    const raw = s?.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // 모양만 확인한다. 내용은 편집기에 다시 넣을 뿐이고 저장할 때 서버가 검증한다
    if (typeof d !== "object" || d === null || typeof d.savedAt !== "string" || !Array.isArray(d.doc?.items)) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, d: Draft, s: KeyValueStore | null = store()): void {
  try {
    s?.setItem(PREFIX + key, JSON.stringify(d));
  } catch {
    // 용량 초과나 접근 차단: 임시 보관만 못 할 뿐 편집은 계속된다
  }
}

export function clearDraft(key: string, s: KeyValueStore | null = store()): void {
  try {
    s?.removeItem(PREFIX + key);
  } catch {}
}

/** 작은 설정값(가져온 것 숨기기 등) */
export function loadFlag(name: string, s: KeyValueStore | null = store()): boolean {
  try {
    return s?.getItem("wakaaka:" + name) === "1";
  } catch {
    return false;
  }
}

export function saveFlag(name: string, on: boolean, s: KeyValueStore | null = store()): void {
  try {
    if (on) s?.setItem("wakaaka:" + name, "1");
    else s?.removeItem("wakaaka:" + name);
  } catch {}
}
