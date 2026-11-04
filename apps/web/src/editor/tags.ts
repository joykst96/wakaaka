// 태그 자동완성 자리와 표기 lint 조각 (DESIGN 11절 "자동완성", "표기 lint"). DOM·네트워크 없는 순수 함수.
// 넣는 표기는 core tagtext(promptTag, escapeText) 한 곳이 정한다. 여기서는 어디에 무엇을 넣을지만 정한다.

import { escapeText, promptTag } from "@wakaaka/core";
import { openRefBefore, tokenize, type Diagnostic, type Token } from "./syntax.ts";

export const TAG_QUERY_MAX = 64;

/** Danbooru 기본 타입 → 이름 (색 토큰 --tag-<이름>) */
export const TAG_CATEGORY_NAMES: Record<number, string> = { 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta" };

const inToken = (toks: readonly Token[], i: number) => toks.some((t) => t.from <= i && i < t.to);

/**
 * 커서 앞이 태그를 칠 자리이면 그 조각. 자리: 칸 맨 앞, 쉼표 뒤, 선택지 `{` `|`(와 보기 가중치 `3*`) 뒤.
 * 앞 공백과 ComfyUI 강조의 여는 `(`는 조각에 넣지 않는다. 조각에 와카아카 문법(참조, 이스케이프, 선택지 기호)이 있으면 아니다.
 */
export function tagFragmentBefore(before: string): { from: number; query: string; inChoice: boolean } | null {
  if (openRefBefore(before)) return null;
  const toks = tokenize(before);
  let start = 0;
  let depth = 0;
  for (const t of toks) {
    if (t.type === "brace") {
      if (before[t.from] === "{") {
        depth++;
        start = t.to;
      } else depth = Math.max(0, depth - 1);
    } else if (t.type === "bar" || t.type === "weight") start = t.to;
  }
  for (let i = before.length - 1; i >= start; i--) {
    if (before[i] === "," && !inToken(toks, i)) {
      start = i + 1;
      break;
    }
  }
  let from = start;
  while (from < before.length && (before[from] === " " || before[from] === "\t" || before[from] === "(")) from++;
  const query = before.slice(from);
  if (query === "" || query.length > TAG_QUERY_MAX || /[\\{}$|]/.test(query)) return null;
  if (toks.some((t) => t.to > from)) return null;
  return { from, query, inChoice: depth > 0 };
}

/** 자동완성이 넣는 글자: 확정 규칙(DESIGN 11절)대로 바꾸고 와카아카 이스케이프. 뒤에 쉼표를 붙이지 않는다 */
export const tagInsertText = (name: string, inChoice: boolean) => escapeText(promptTag(name), inChoice);

/** 목록에 보이는 이름: 밑줄 규칙만(괄호 이스케이프 없이) */
export const tagDisplayName = (name: string) => promptTag(name).replaceAll("\\(", "(").replaceAll("\\)", ")");

export function formatPostCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

export interface TagPiece {
  from: number;
  to: number;
  text: string;
  inChoice: boolean;
}

/**
 * 항목 텍스트를 태그 조각으로 나눈다: 쉼표와 와카아카·바깥 표기 토큰(참조, 선택지 기호, ComfyUI `(`·`:1.2)`, NAI `::` 등)이 경계.
 * 앞뒤 공백은 뺀다. 토큰 안의 쉼표는 경계가 아니다.
 */
export function tagPieces(text: string): TagPiece[] {
  const toks = tokenize(text);
  const out: TagPiece[] = [];
  let depth = 0;
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (a < b) out.push({ from: a, to: b, text: text.slice(a, b), inChoice: depth > 0 });
  };
  const segment = (a: number, b: number) => {
    let s = a;
    for (let i = a; i < b; i++) {
      if (text[i] === ",") {
        push(s, i);
        s = i + 1;
      }
    }
    push(s, b);
  };
  let at = 0;
  for (const t of toks) {
    if (t.from < at) continue; // 겹친 토큰(바깥 표기 안의 것)은 이미 지나감
    segment(at, t.from);
    if (t.type === "brace") depth = text[t.from] === "{" ? depth + 1 : Math.max(0, depth - 1);
    at = t.to;
  }
  segment(at, text.length);
  return out;
}

const UNESCAPED_PAREN = /(?<!\\)[()]/;

/** 조각이 태그 DB의 이름일 수 있으면 그 이름(Danbooru 표기). 밑줄이나 이스케이프 안 된 괄호가 있을 때만 본다 */
export function lintCandidate(piece: string): string | null {
  if (!piece.includes("_") && !UNESCAPED_PAREN.test(piece)) return null;
  const name = piece.replace(/\\([()])/g, "$1").replace(/\s+/g, "_").toLowerCase();
  return name.length > 256 ? null : name;
}

export interface TagLookup {
  /** undefined: 아직 모름(요청함), null: 태그 DB에 없음 */
  get(name: string): { category: number } | null | undefined;
  request(names: Iterable<string>): void;
}

export interface TagFix {
  from: number;
  to: number;
  insert: string;
}

/**
 * 표기 lint: 조각이 태그 DB의 태그인데 밑줄로 썼거나 괄호를 이스케이프하지 않았으면 정보 진단과 고칠 표기.
 * 자동으로 바꾸지 않는다(사용자가 친 글자는 그대로 둔다, DESIGN 11절).
 */
export function tagLint(text: string, tags: TagLookup): Array<Diagnostic & { fix: TagFix }> {
  const out: Array<Diagnostic & { fix: TagFix }> = [];
  const asked: string[] = [];
  for (const p of tagPieces(text)) {
    const name = lintCandidate(p.text);
    if (name === null) continue;
    const info = tags.get(name);
    if (info === undefined) asked.push(name);
    if (!info) continue;
    const expected = tagInsertText(name, p.inChoice);
    if (expected === p.text) continue;
    const reasons: string[] = [];
    if (/_/.test(p.text) && !/_/.test(expected)) reasons.push("밑줄 표기입니다");
    if (UNESCAPED_PAREN.test(p.text)) reasons.push("괄호가 ComfyUI 가중치로 읽힙니다");
    if (reasons.length === 0) continue; // 대소문자만 다른 것 등은 안내하지 않는다
    out.push({ from: p.from, to: p.to, severity: "info", message: `${reasons.join(". ")}. 고치면: ${expected}`, fix: { from: p.from, to: p.to, insert: expected } });
  }
  if (asked.length > 0) tags.request(asked);
  return out;
}
