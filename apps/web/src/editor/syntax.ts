// 편집기 구문 표시와 오류 밑줄. CodeMirror 칸과 정적 칸(포커스 없는 항목)이 같이 쓴다.
// 색칠용 토큰은 SPEC 2.2 읽는 순서를 그대로 따라 훑는다. 오류는 core parse가 기준이다(파서 위치, UTF-16).

import { classifyRefBody, parse, type Node } from "@wakaaka/core";

/** 바깥 프롬프트 표기: 와카아카 문법이 아니라 그대로 ComfyUI·NAI로 넘어가는 것. 색만 달리하고 뜻은 바꾸지 않는다 */
export type ForeignKind = "comfy" | "lora" | "nai" | "break";

export type Token =
  | { type: "escape"; from: number; to: number }
  /** depth: 그 괄호·세로선이 속한 선택지가 몇 겹째인지(1부터). 짝이 맞는 괄호는 같은 depth다 */
  | { type: "brace"; from: number; to: number; depth: number }
  | { type: "bar"; from: number; to: number; depth: number }
  | { type: "wref"; from: number; to: number; id: string }
  | { type: "nameref"; from: number; to: number; name: string }
  | { type: "badref"; from: number; to: number }
  /** 선택지 보기 맨 앞의 가중치 `3*` (SPEC 2.2 규칙 0). 소수 등 틀린 표기도 색칠하고, 오류는 파서가 낸다 */
  | { type: "weight"; from: number; to: number }
  | { type: "foreign"; from: number; to: number; kind: ForeignKind };

const ALT_WEIGHT = /[0-9.]+[*]/y;

/** 색칠용 토큰(위치순). 오류가 있어도 끝까지 훑는다(닫히지 않은 참조는 끝까지 badref) */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let depth = 0;
  let altStart = false;
  for (let i = 0; i < text.length; ) {
    if (altStart) {
      altStart = false;
      ALT_WEIGHT.lastIndex = i;
      const m = ALT_WEIGHT.exec(text);
      if (m) {
        out.push({ type: "weight", from: i, to: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    const c = text[i];
    const n = text[i + 1];
    if (c === "\\" && n !== undefined && (n === "{" || n === "}" || n === "$" || n === "\\" || (depth > 0 && n === "|"))) {
      out.push({ type: "escape", from: i, to: i + 2 });
      i += 2;
    } else if (c === "$" && n === "{") {
      const close = text.indexOf("}", i + 2);
      if (close < 0) {
        out.push({ type: "badref", from: i, to: text.length });
        break;
      }
      const body = classifyRefBody(text.slice(i + 2, close), "edit");
      if ("error" in body) out.push({ type: "badref", from: i, to: close + 1 });
      else if (body.kind === "w") out.push({ type: "wref", from: i, to: close + 1, id: body.id });
      else out.push({ type: "nameref", from: i, to: close + 1, name: body.name });
      i = close + 1;
    } else if (c === "{") {
      depth++;
      out.push({ type: "brace", from: i, to: i + 1, depth });
      i++;
      altStart = true;
    } else if (c === "}") {
      out.push({ type: "brace", from: i, to: i + 1, depth: Math.max(depth, 1) });
      if (depth > 0) depth--;
      i++;
    } else if (c === "|" && depth > 0) {
      out.push({ type: "bar", from: i, to: i + 1, depth });
      i++;
      altStart = true;
    } else i++;
  }
  // 바깥 표기는 와카아카 토큰(참조, 이스케이프, 선택지 기호)과 겹치지 않는 것만
  const ours = out.slice();
  const free = (f: number, t: number) => !ours.some((o) => o.from < t && f < o.to);
  for (const x of foreignTokens(text)) if (free(x.from, x.to)) out.push(x);
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * 바깥 프롬프트 표기 (색칠용, 실제 해석은 ComfyUI·NAI가 한다):
 * - LoRA 등 `<lora:이름:0.8>` 전체
 * - ComfyUI 강조 `(tag:1.2)`의 여는 `(`와 `:1.2)` (`\(`는 ComfyUI에서 글자라 짝으로 치지 않는다)
 * - NAI 숫자 강조 `1.2::`와 닫는 `::`
 * - `BREAK`
 */
export function foreignTokens(text: string): Array<{ type: "foreign"; from: number; to: number; kind: ForeignKind }> {
  const out: Array<{ type: "foreign"; from: number; to: number; kind: ForeignKind }> = [];
  const add = (from: number, to: number, kind: ForeignKind) => out.push({ type: "foreign", from, to, kind });
  const escaped = (j: number) => {
    let k = j - 1;
    while (k >= 0 && text[k] === "\\") k--;
    return (j - 1 - k) % 2 === 1;
  };
  for (const m of text.matchAll(/<(?:lora|lyco|hypernet|embedding):[^<>\n]*>/gi)) add(m.index, m.index + m[0].length, "lora");
  for (const m of text.matchAll(/:-?\d+(?:\.\d+)?\)/g)) {
    if (escaped(m.index + m[0].length - 1)) continue;
    let level = 0;
    for (let j = m.index - 1; j >= 0; j--) {
      const ch = text[j];
      if ((ch !== "(" && ch !== ")") || escaped(j)) continue;
      if (ch === ")") level++;
      else if (level === 0) {
        add(j, j + 1, "comfy");
        add(m.index, m.index + m[0].length, "comfy");
        break;
      } else level--;
    }
  }
  const openers: Array<[number, number]> = [];
  for (const m of text.matchAll(/(?<![\w.:])-?\d+(?:\.\d+)?::/g)) {
    openers.push([m.index, m.index + m[0].length]);
    add(m.index, m.index + m[0].length, "nai");
  }
  for (const m of text.matchAll(/::/g)) {
    if (openers.some(([f, t]) => f <= m.index && m.index < t)) continue;
    add(m.index, m.index + 2, "nai");
  }
  for (const m of text.matchAll(/\bBREAK\b/g)) add(m.index, m.index + 5, "break");
  return out;
}

export interface Diagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** "고치기"로 [from, to)를 바꿀 글자 (편집기 칸에서만 보인다) */
  fix?: { from: number; to: number; insert: string };
}

export interface LintContext {
  /** 내 지우지 않은 와일드카드 ID. null이면 참조 검사를 하지 않는다(남의 와일드카드 보기) */
  mineIds: ReadonlySet<string> | null;
  /** 이름(소문자) → 내 와일드카드 ID */
  mineNames: ReadonlyMap<string, string> | null;
  /** 문법이 맞을 때 더하는 진단(태그 표기 lint, editor/tags.ts) */
  extra?(text: string): Diagnostic[];
}

const SYNTAX_MESSAGES: Record<string, string> = {
  E_UNCLOSED_CHOICE: "닫히지 않은 {",
  E_UNMATCHED_CLOSE: "짝이 없는 }",
  E_UNCLOSED_REF: "닫히지 않은 ${",
  E_REF_EMPTY: "빈 참조",
  E_REF_INVALID: "참조에 쓸 수 없는 글자",
  E_REF_RESERVED: "예약된 문법(매개변수·변수·h:)",
  E_REF_NAME: "이름 참조",
  E_NESTING: "선택지가 64겹을 넘음",
  E_CHOICE_WEIGHT: "보기 가중치는 0~1,000,000 정수(예: 3*)이고, 모든 보기가 0이면 안 됨",
};

export const syntaxMessage = (code: string) => SYNTAX_MESSAGES[code] ?? code;

const IMPACT_WEIGHT = /^[0-9]+(?:[.][0-9]+)?::/;
const SPACED_WEIGHT = /^[ \t]+[0-9]+[*]/;

/**
 * 선택지 보기 안내(오류 아님, 뜻은 바꾸지 않는다):
 * - Impact Pack식 `{3::a|b}`: 닫는 `::`가 없으면 NAI 강조가 아니라 가중치를 쓰려던 것으로 보고 `3*`를 알려 준다
 * - `{ 3*a}`: 앞 공백 때문에 가중치가 아니라 글자가 됐다
 */
export function choiceHints(text: string, nodes: readonly Node[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const walk = (list: readonly Node[]) => {
    for (const nd of list) {
      if (nd.type !== "choice") continue;
      nd.alts.forEach((alt, i) => {
        if (nd.weightEnds[i] !== nd.altStarts[i]) return walk(alt);
        const from = nd.altStarts[i]!;
        const to = i + 1 < nd.alts.length ? nd.altStarts[i + 1]! - 1 : nd.end - 1;
        const raw = text.slice(from, to);
        const impact = IMPACT_WEIGHT.exec(raw);
        if (impact && !raw.slice(impact[0].length).includes("::")) {
          out.push({ from, to: from + impact[0].length, severity: "info", message: `와카아카 보기 가중치는 ${impact[0].replace("::", "*")}처럼 씁니다(Impact Pack의 ::는 글자로 남습니다)` });
        }
        const spaced = SPACED_WEIGHT.exec(raw);
        if (spaced) out.push({ from, to: from + spaced[0].length, severity: "info", message: "가중치로 쓰려면 { 나 | 바로 뒤에 공백 없이 붙여 씁니다" });
        walk(alt);
      });
    }
  };
  walk(nodes);
  return out;
}

/** 항목 텍스트 하나의 진단: 문법 오류(파서 위치), 없는 참조, 저장할 때 고를 이름 참조 */
export function diagnose(text: string, ctx: LintContext): Diagnostic[] {
  const p = parse(text, "edit");
  if (!p.ok) {
    const { code, start, end } = p.error;
    return [{ from: start, to: Math.max(end, start + 1), severity: "error", message: syntaxMessage(code) }];
  }
  if (ctx.mineIds === null) return [];
  const out: Diagnostic[] = choiceHints(text, p.nodes);
  for (const t of tokenize(text)) {
    if (t.type === "wref" && !ctx.mineIds.has(t.id)) {
      out.push({ from: t.from, to: t.to, severity: "error", message: "내 와일드카드가 아니거나 지워진 참조입니다" });
    } else if (t.type === "nameref" && !ctx.mineNames?.has(t.name.toLowerCase())) {
      out.push({ from: t.from, to: t.to, severity: "info", message: `내 와일드카드에 "${t.name}"이 없습니다. 저장할 때 고릅니다` });
    }
  }
  if (ctx.extra) out.push(...ctx.extra(text));
  return out;
}

/** 자동완성: 커서 앞이 열린 `${…`이면 그 시작과 입력한 글자 */
export function openRefBefore(textBefore: string): { from: number; query: string } | null {
  // 이스케이프된 \$는 참조가 아니다: 토큰으로 판단한다
  const at = textBefore.lastIndexOf("${");
  if (at < 0) return null;
  const query = textBefore.slice(at + 2);
  if (query.includes("}")) return null;
  const toks = tokenize(textBefore);
  const last = toks[toks.length - 1];
  if (!last || last.from !== at || last.type !== "badref") return null;
  return { from: at, query };
}
