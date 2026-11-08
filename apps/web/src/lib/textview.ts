// 텍스트 보기 (DESIGN 11절): 한 줄에 항목 하나. 고치고 돌아오면 줄을 비교해 항목 ID를 유지한다.
//
// 줄 형식 (선택지 보기 가중치와 같은 `*` 표기, NOTES Phase 3 "보기 가중치"):
//   red hair          가중치 없음(w 필드 없음)
//   3* red hair       w = 3. `*` 뒤 공백 하나는 구분용이라 텍스트에 들어가지 않는다
//   *                 빈 텍스트 항목(가중치 없음)
//   * 3*x             w 없음을 명시하고 뒤는 글자. 텍스트가 `숫자*`나 `* `로 시작하거나 `*` 한 글자일 때 쓴다
//   ${w:ID}           참조 항목(ref)은 이렇게 보이고, 돌아올 때 바뀌지 않았으면 펼침(spread)까지 그대로 남는다
// `*sparkle*`처럼 `*` 바로 뒤가 공백이 아니면 그냥 글자다. 빈 줄은 항목이 아니다. 줄바꿈이 든 항목이 있으면 텍스트 보기를 쓸 수 없다.
// 2026-11-03 전에는 `3::`였다. NAI 강조 `2::tag::`를 가중치로 읽는 모호함이 있어 바꿨다(이제 `3::`는 글자, 편집기가 안내한다).
//
// ID 유지: 정확히 같은 줄끼리 LCS로 짝을 짓고(바뀌지 않은 줄 = 기존 ID), 짝 사이 구간에서는
// 남은 옛 줄과 새 줄을 앞에서부터 위치로 짝짓는다(같은 위치에서 고친 줄 = 기존 ID). 남는 새 줄만 새 ID다.

import { isCommentItem, MAX_WEIGHT } from "@wakaaka/core";
import { newItemId, type EditItem } from "./editdoc.ts";

/** 가중치 줄: `3* 텍스트` */
export const WEIGHT_PREFIX = /^([0-9]+)\* ?/;
/** 가중치 없음을 명시한 줄: `*` 또는 `* 텍스트` */
const PLAIN_PREFIX = /^\*(?: |$)/;
const REF_LINE = /^\$\{w:([0-9A-Za-z]{12})\}$/;

/** 줄 맨 앞의 줄 형식 표기 길이(편집기 색칠용). 없으면 0 */
export function linePrefixLength(line: string): number {
  return WEIGHT_PREFIX.exec(line)?.[0].length ?? PLAIN_PREFIX.exec(line)?.[0].length ?? 0;
}

export function canUseTextView(items: readonly EditItem[]): boolean {
  return items.every((it) => it.ref !== undefined || !/[\r\n]/.test(it.text ?? ""));
}

export function itemToLine(it: EditItem): string {
  const body = it.ref !== undefined ? "${w:" + it.ref + "}" : (it.text ?? "");
  if (it.w !== undefined && !(it.ref !== undefined && it.spread === true)) return `${it.w}* ${body}`;
  if (body === "") return "*";
  if (/^[0-9]+\*/.test(body) || PLAIN_PREFIX.test(body)) return `* ${body}`;
  return body;
}

export function itemsToText(items: readonly EditItem[]): string {
  return items.map(itemToLine).join("\n");
}

/**
 * 내보내기(와카아카 형식)용 텍스트: 텍스트 보기와 같은 줄 형식에서 주석 항목(SPEC 2.7)만 뺀다(DESIGN 3절 "주석 항목").
 * 주석은 결과에 영향이 없으므로 빼도 전개 결과가 같다. 주석이 없으면 itemsToText와 같다.
 */
export function itemsToExportText(items: readonly EditItem[]): string {
  return itemsToText(items.filter((it) => !isCommentItem(it)));
}

export interface LineParse {
  text: string;
  w?: number;
  /** 가중치가 범위를 벗어남 */
  badWeight?: boolean;
}

export function parseLine(line: string): LineParse {
  const m = WEIGHT_PREFIX.exec(line);
  if (m) {
    const text = line.slice(m[0].length);
    const w = Number(m[1]);
    return w > MAX_WEIGHT ? { text, w, badWeight: true } : { text, w };
  }
  const plain = PLAIN_PREFIX.exec(line);
  return plain ? { text: line.slice(plain[0].length) } : { text: line };
}

/** 텍스트를 줄로. 빈 줄은 뺀다 */
export function textLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((l) => l !== "");
}

/**
 * 옛 줄 a와 새 줄 b의 짝 (옛 번호 → 새 번호). 같은 줄끼리 먼저 짝짓고(sameLineAnchors), 그 사이 구간은 위치로 짝짓는다.
 */
export function matchLines(a: readonly string[], b: readonly string[]): Map<number, number> {
  const anchors = sameLineAnchors(a, b, 0, a.length, 0, b.length, 0);
  const pairs = new Map<number, number>();
  // 같은 줄 짝 사이 구간은 위치로 짝짓는다
  let pa = 0;
  let pb = 0;
  for (const [x, y] of [...anchors, [a.length, b.length] as [number, number]]) {
    for (let k = 0; pa + k < x && pb + k < y; k++) pairs.set(pa + k, pb + k);
    if (x < a.length) pairs.set(x, y);
    pa = x + 1;
    pb = y + 1;
  }
  return pairs;
}

/**
 * a[a0..a1)과 b[b0..b1)에서 같은 줄의 짝(옛, 새)을 순서대로. 앞뒤 공통 부분을 떼고, 남은 부분이 작으면 LCS(DP),
 * 크면 양쪽에서 한 번씩만 나오는 줄을 기준점으로 삼아(patience diff) 그 사이 구간마다 다시 푼다.
 */
function sameLineAnchors(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number, depth: number): Array<[number, number]> {
  const head: Array<[number, number]> = [];
  const tail: Array<[number, number]> = [];
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) head.push([a0++, b0++]);
  while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) tail.unshift([--a1, --b1]);
  const n = a1 - a0;
  const m = b1 - b0;
  const mid: Array<[number, number]> = [];
  if (n > 0 && m > 0 && n * m <= 4_000_000) {
    // dp[i][j] = a[a0+i..a1)와 b[b0+j..b1)의 LCS 길이 (뒤에서부터)
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[a0 + i] === b[b0 + j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[a0 + i] === b[b0 + j]) mid.push([a0 + i++, b0 + j++]);
      else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
      else j++;
    }
  } else if (n > 0 && m > 0 && depth < 8) {
    const unique = patienceAnchors(a, b, a0, a1, b0, b1);
    let pa = a0;
    let pb = b0;
    for (const [x, y] of [...unique, [a1, b1] as [number, number]]) {
      mid.push(...sameLineAnchors(a, b, pa, x, pb, y, depth + 1));
      if (x < a1) mid.push([x, y]);
      pa = x + 1;
      pb = y + 1;
    }
  }
  return [...head, ...mid, ...tail];
}

/** 두 구간에서 각각 한 번씩만 나오는 줄의 짝 중 순서가 맞는 가장 긴 것(LIS) */
function patienceAnchors(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number): Array<[number, number]> {
  const count = (xs: readonly string[], s: number, e: number) => {
    const m = new Map<string, number>();
    for (let i = s; i < e; i++) m.set(xs[i]!, m.has(xs[i]!) ? -1 : i);
    return m;
  };
  const ua = count(a, a0, a1);
  const ub = count(b, b0, b1);
  const cand: Array<[number, number]> = [];
  for (let i = a0; i < a1; i++) {
    const j = ub.get(a[i]!);
    if (ua.get(a[i]!) === i && j !== undefined && j >= 0) cand.push([i, j]);
  }
  // b 번호의 가장 긴 증가 부분열 (이분 탐색)
  const tails: number[] = [];
  const prev = new Array<number>(cand.length).fill(-1);
  for (let k = 0; k < cand.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cand[tails[mid]!]![1] < cand[k]![1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const out: Array<[number, number]> = [];
  for (let k = tails.length > 0 ? tails[tails.length - 1]! : -1; k >= 0; k = prev[k]!) out.unshift(cand[k]!);
  return out;
}

export interface TextToItemsResult {
  items: EditItem[];
  /** 가중치가 범위를 벗어난 줄 번호(0부터, 빈 줄을 뺀 번호) */
  badWeights: number[];
}

/** 텍스트 보기에서 돌아올 때: 옛 항목의 ID를 줄 비교로 이어 받는다 */
export function textToItems(oldItems: readonly EditItem[], text: string, random?: (n: number) => Uint8Array): TextToItemsResult {
  const oldLines = oldItems.map(itemToLine);
  const lines = textLines(text);
  const pairs = matchLines(oldLines, lines);
  const fromOld = new Map<number, number>(); // 새 줄 번호 → 옛 항목 번호
  for (const [i, j] of pairs) fromOld.set(j, i);

  const taken = new Set<string>();
  for (const i of fromOld.values()) taken.add(oldItems[i]!.id);
  const badWeights: number[] = [];
  const items = lines.map((line, j) => {
    const oi = fromOld.get(j);
    const old = oi === undefined ? undefined : oldItems[oi]!;
    // 바뀌지 않은 줄은 옛 항목 그대로(ref·spread 포함)
    if (old && oldLines[oi!] === line) return { ...old };
    const p = parseLine(line);
    if (p.badWeight) badWeights.push(j);
    let id = old?.id;
    if (id === undefined) {
      id = newItemId(taken, random);
      taken.add(id);
    }
    const it: EditItem = { id, text: p.text };
    if (p.w !== undefined) it.w = p.w;
    // 펼침 항목이었던 줄에서 가중치만 빼고 참조는 그대로면 펼침을 유지한다
    const ref = REF_LINE.exec(p.text);
    if (old?.ref !== undefined && ref && ref[1] === old.ref) {
      delete it.text;
      it.ref = old.ref;
      if (old.spread !== undefined && (p.w === undefined || old.spread === false)) it.spread = old.spread;
    }
    return it;
  });
  return { items, badWeights };
}
