// 인라인 문법 파서 (SPEC 2절). 특수문자는 모두 ASCII라서 UTF-16 단위로 읽어도 코드 포인트 단위와 결과가 같다.
// 위치는 모두 UTF-16 오프셋이고 [start, end) 범위다.

import { isSpecWhitespace, trimSpecWhitespace } from "./cleanup.ts";

export type ParseMode = "stored" | "edit";

export type SyntaxErrorCode =
  | "E_UNCLOSED_CHOICE"
  | "E_UNMATCHED_CLOSE"
  | "E_UNCLOSED_REF"
  | "E_REF_EMPTY"
  | "E_REF_INVALID"
  | "E_REF_RESERVED"
  | "E_REF_NAME"
  | "E_NESTING"
  | "E_CHOICE_WEIGHT";

export const MAX_CHOICE_NESTING = 64;
/** 보기 가중치 상한 (SPEC 2.2 규칙 0, 항목 w와 같다) */
export const MAX_CHOICE_WEIGHT = 1_000_000;

export interface TextNode {
  type: "text";
  value: string;
  start: number;
  end: number;
}
export interface WildcardRefNode {
  type: "ref";
  kind: "w";
  id: string;
  /** 노드 번호 (SPEC 2.4) */
  n: number;
  start: number;
  end: number;
}
export interface NameRefNode {
  type: "ref";
  kind: "name";
  name: string;
  n: number;
  start: number;
  end: number;
}
export interface ChoiceNode {
  type: "choice";
  alts: Node[][];
  /** 보기 가중치. 적지 않은 보기는 1 (SPEC 2.2 규칙 0) */
  weights: number[];
  /** 가중치를 하나라도 적었는지 (공통 구문 트리의 "w") */
  weighted: boolean;
  /** 각 보기의 시작 위치(`{`·`|` 바로 뒤)와 가중치 표기가 끝나는 위치(없으면 시작과 같음). 편집기가 가중치를 고칠 때 쓴다 */
  altStarts: number[];
  weightEnds: number[];
  n: number;
  start: number;
  end: number;
}
export type RefNode = WildcardRefNode | NameRefNode;
export type Node = TextNode | RefNode | ChoiceNode;

export interface ParseError {
  code: SyntaxErrorCode;
  start: number;
  end: number;
}

/**
 * comment: 주석 텍스트(SPEC 2.7). 인라인 문법을 읽지 않으므로 nodes는 비어 있고 참조도 없다.
 * 전개·후보에서 빼는 것은 부르는 쪽 일이다(isComment). 빈 노드 목록이라 참조를 모으는 쪽은 따로 거르지 않아도 된다.
 */
export type ParseResult = { ok: true; nodes: Node[]; nodeCount: number; comment?: true } | { ok: false; error: ParseError };

/** 주석 항목의 텍스트인지 (SPEC 2.7): 첫 글자가 `#`. 앞 공백·전각 `＃`은 아니다 */
export const isComment = (text: string): boolean => text.startsWith("#");

/** 문서 항목이 주석 항목인지 (text 항목만 주석이 될 수 있다) */
export const isCommentItem = (it: { text?: string | undefined }): boolean => it.text !== undefined && isComment(it.text);

const STORED_REF = /^w:[0-9A-Za-z]{12}$/;
/** 보기 맨 앞의 숫자·점 + `*` (SPEC 2.2 규칙 0). sticky: lastIndex 자리에서만 맞춘다 */
const ALT_WEIGHT = /[0-9.]+\*/y;

type RefBody = { kind: "w"; id: string } | { kind: "name"; name: string } | { error: SyntaxErrorCode };

/** 참조 본문 판정 (SPEC 2.3 표의 순서). */
export function classifyRefBody(body: string, mode: ParseMode): RefBody {
  let blank = true;
  for (let i = 0; i < body.length; i++) if (!isSpecWhitespace(body.charCodeAt(i))) blank = false;
  if (blank) return { error: "E_REF_EMPTY" };
  if (body.includes("=")) return { error: "E_REF_RESERVED" };
  if (/[{$\\|]/.test(body)) return { error: "E_REF_INVALID" };
  if (body.startsWith("h:")) return { error: "E_REF_RESERVED" };
  if (STORED_REF.test(body)) return { kind: "w", id: body.slice(2) };
  if (body.includes(":")) return { error: "E_REF_INVALID" };
  if (mode === "stored") return { error: "E_REF_NAME" };
  return { kind: "name", name: trimSpecWhitespace(body) };
}

interface Frame {
  choice: ChoiceNode;
  /** 지금 채우는 보기 */
  alt: Node[];
}

export function parse(text: string, mode: ParseMode = "stored"): ParseResult {
  // SPEC 2.2 맨 앞: `#`면 주석(아무것도 읽지 않는다)
  if (isComment(text)) return { ok: true, nodes: [], nodeCount: 0, comment: true };
  const root: Node[] = [];
  const stack: Frame[] = [];
  let counter = 0;
  let lit = "";
  let litStart = 0;

  const current = (): Node[] => (stack.length > 0 ? stack[stack.length - 1]!.alt : root);
  const addChar = (ch: string, at: number) => {
    if (lit === "") litStart = at;
    lit += ch;
  };
  const flush = (at: number) => {
    if (lit !== "") current().push({ type: "text", value: lit, start: litStart, end: at });
    lit = "";
  };
  const fail = (code: SyntaxErrorCode, start: number, end: number): ParseResult => ({ ok: false, error: { code, start, end } });

  let i = 0;
  // SPEC 2.2 맨 앞: `\#`은 글자 `#` (텍스트 맨 앞에서만 이스케이프)
  if (text.startsWith("\\#")) {
    addChar("#", 0);
    i = 2;
  }
  let altStart = false; // 바로 앞에서 선택지를 열었거나 보기를 나눴다
  while (i < text.length) {
    // 0. 보기 시작의 가중치 `정수*` (SPEC 2.2)
    if (altStart) {
      altStart = false;
      ALT_WEIGHT.lastIndex = i;
      const m = ALT_WEIGHT.exec(text);
      if (m) {
        const digits = m[0].slice(0, -1);
        // 숫자가 아무리 길어도 Number는 MAX보다 크거나 Infinity가 되어 걸린다. 앞의 0은 값에 영향이 없다
        if (digits.includes(".") || Number(digits) > MAX_CHOICE_WEIGHT) {
          return fail("E_CHOICE_WEIGHT", i, i + m[0].length);
        }
        const top = stack[stack.length - 1]!.choice;
        top.weights[top.weights.length - 1] = Number(digits);
        top.weighted = true;
        i += m[0].length;
        top.weightEnds[top.weightEnds.length - 1] = i;
        continue;
      }
    }
    const c = text[i]!;
    const next = text[i + 1];
    const inChoice = stack.length > 0;
    // 1. 이스케이프
    if (c === "\\" && next !== undefined && (next === "{" || next === "}" || next === "$" || next === "\\" || (inChoice && next === "|"))) {
      addChar(next, i);
      i += 2;
      continue;
    }
    // 2. 참조
    if (c === "$" && next === "{") {
      const close = text.indexOf("}", i + 2);
      if (close < 0) return fail("E_UNCLOSED_REF", i, text.length);
      const body = classifyRefBody(text.slice(i + 2, close), mode);
      if ("error" in body) return fail(body.error, i, close + 1);
      flush(i);
      const n = counter++;
      current().push(body.kind === "w" ? { type: "ref", kind: "w", id: body.id, n, start: i, end: close + 1 } : { type: "ref", kind: "name", name: body.name, n, start: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    // 3. 선택지 시작
    if (c === "{") {
      if (stack.length >= MAX_CHOICE_NESTING) return fail("E_NESTING", i, i + 1);
      flush(i);
      const choice: ChoiceNode = { type: "choice", alts: [[]], weights: [1], weighted: false, altStarts: [i + 1], weightEnds: [i + 1], n: counter++, start: i, end: -1 };
      current().push(choice);
      stack.push({ choice, alt: choice.alts[0]! });
      i += 1;
      altStart = true;
      continue;
    }
    // 4. 보기 나누기
    if (c === "|" && inChoice) {
      flush(i);
      const top = stack[stack.length - 1]!;
      top.alt = [];
      top.choice.alts.push(top.alt);
      top.choice.weights.push(1);
      top.choice.altStarts.push(i + 1);
      top.choice.weightEnds.push(i + 1);
      i += 1;
      altStart = true;
      continue;
    }
    // 5. 선택지 닫기
    if (c === "}") {
      if (!inChoice) return fail("E_UNMATCHED_CLOSE", i, i + 1);
      flush(i);
      const closed = stack.pop()!.choice;
      closed.end = i + 1;
      if (closed.weights.every((w) => w === 0)) return fail("E_CHOICE_WEIGHT", closed.start, closed.start + 1);
      i += 1;
      continue;
    }
    // 6. 글자 그대로
    addChar(c, i);
    i += 1;
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1]!.choice;
    return fail("E_UNCLOSED_CHOICE", open.start, open.start + 1);
  }
  flush(text.length);
  return { ok: true, nodes: root, nodeCount: counter };
}

/** 공통 테스트 세트의 구문 트리 표기 (SPEC 2.4). */
export type CommonNode = string | { ref: "w"; id: string } | { ref: "name"; name: string } | { choice: CommonNode[][]; w?: number[] };

export function toCommonAst(nodes: readonly Node[]): CommonNode[] {
  return nodes.map((nd): CommonNode => {
    if (nd.type === "text") return nd.value;
    if (nd.type === "ref") return nd.kind === "w" ? { ref: "w", id: nd.id } : { ref: "name", name: nd.name };
    return nd.weighted ? { choice: nd.alts.map(toCommonAst), w: [...nd.weights] } : { choice: nd.alts.map(toCommonAst) };
  });
}

/** 텍스트 안의 모든 참조(뽑히지 않을 보기 안 포함). */
export function collectRefs(nodes: readonly Node[], out: RefNode[] = []): RefNode[] {
  for (const nd of nodes) {
    if (nd.type === "ref") out.push(nd);
    else if (nd.type === "choice") for (const alt of nd.alts) collectRefs(alt, out);
  }
  return out;
}
