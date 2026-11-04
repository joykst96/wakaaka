// 내보내기: Impact Pack 와일드카드 노드용 프롬프트 한 줄 (DESIGN 11절 "Impact Pack 내보내기").
// 전개 명세와 무관하다. 하위 와일드카드를 모두 그 자리에 펼쳐 Impact의 {w::a|w::b} 선택지로 만든다.
// Impact의 해석 방식은 ComfyUI-Impact-Pack modules/impact/wildcards.py process()를 읽고 실행해 확인했다(NOTES Phase 3 "Impact Pack 내보내기").
// 코드는 가져오지 않았다(GPL-3.0).

import { expand, type ExpandError } from "./expand.ts";
import { parse, type Node } from "./parser.ts";
import { expandDocSchema, type ExpandDoc } from "./schema.ts";

export type ImpactWarningCode =
  /** 글자 | : Impact 선택지 안에서 보기를 나눠 버린다 */
  | "W_PIPE"
  /** 글자 { } : Impact에서 \{ \}로 남는다 */
  | "W_BRACE"
  /** $$ : Impact 개수 문법과 겹친다 */
  | "W_DOLLARS"
  /** __이름__ : Impact가 와일드카드 파일 참조로 읽는다 */
  | "W_WILDCARD_FILE"
  /** 줄바꿈을 공백으로 바꿨다 (Impact는 #로 시작하는 줄을 주석으로 지운다) */
  | "W_NEWLINE"
  /** 구분자에 | $$ { } 가 있다 */
  | "W_SEP"
  /** 결과가 100KB를 넘는다 */
  | "W_SIZE";

export interface ImpactWarning {
  code: ImpactWarningCode;
  /** 문제가 난 문서의 해시와 와일드카드 ID(루트는 rootWildcard, 없으면 null), 항목 ID(구분자·크기 경고는 없음) */
  hash: string;
  wildcard: string | null;
  item?: string;
}

export type ImpactResult = { ok: true; text: string; warnings: ImpactWarning[] } | { ok: false; error: ExpandError };

export const IMPACT_SIZE_WARN = 100 * 1024;
const WILDCARD_FILE = /__[\w.\-+/*\\]+?__/;

/**
 * 묶음 → Impact Pack 프롬프트 한 줄. 묶음은 전개할 수 있어야 한다(문법·참조·순환·깊이 오류면 그 오류를 돌려준다).
 * - 와일드카드: {a-b$$구분자$$w::항목|…} (개수 1~1이면 {w::항목|…}). 가중치 0은 뺀다. 펼친 참조는 대상 항목을 같은 목록에
 * - 참조: 그 자리에 같은 규칙으로 펼친다. 선택지 {3*a|b} → {3::a|1::b}
 * - 모든 보기에 가중치를 적는다: Impact는 보기 맨 앞의 숫자:: 하나만 떼므로 NAI 강조로 시작하는 보기도 안전하고,
 *   가중치 합이 1 이하이면 전부 출력하는 동작을 피하려고 가중치 0인 보기는 남기지 않는다
 */
export function toImpactPrompt(bundle: unknown, options: { rootWildcard?: string } = {}): ImpactResult {
  const check = expand(bundle, 0n, options.rootWildcard ? { rootWildcard: options.rootWildcard } : {});
  // 전개 횟수 상한은 seed마다 다르다. 변환은 할 수 있으므로 그 경우만 넘어간다
  if (!check.ok && check.error.code !== "E_BUDGET") return { ok: false, error: check.error };

  const b = bundle as { root: string; lock: Record<string, string>; docs: Record<string, unknown> };
  const docs = new Map<string, ExpandDoc>();
  const docOf = (hash: string): ExpandDoc => {
    let d = docs.get(hash);
    if (!d) {
      d = expandDocSchema.parse(b.docs[hash]);
      docs.set(hash, d);
    }
    return d;
  };
  const hashOf = (wildcard: string) => b.lock[wildcard]!;
  const warnings: ImpactWarning[] = [];
  const seen = new Set<string>();
  const warn = (code: ImpactWarningCode, hash: string, wildcard: string | null, item?: string) => {
    const key = `${code}:${hash}:${item ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(item === undefined ? { code, hash, wildcard } : { code, hash, wildcard, item });
  };

  const literal = (s: string, hash: string, wildcard: string | null, item: string): string => {
    if (s.includes("|")) warn("W_PIPE", hash, wildcard, item);
    if (s.includes("$$")) warn("W_DOLLARS", hash, wildcard, item);
    if (WILDCARD_FILE.test(s)) warn("W_WILDCARD_FILE", hash, wildcard, item);
    if (/[\r\n]/.test(s)) warn("W_NEWLINE", hash, wildcard, item);
    if (/[{}]/.test(s)) warn("W_BRACE", hash, wildcard, item);
    // Impact는 \{ \}를 선택지로 보지 않는다(백슬래시는 결과에 남는다)
    return s.replace(/\r\n|\r|\n/g, " ").replace(/[{}]/g, "\\$&");
  };

  const nodes = (list: readonly Node[], hash: string, wildcard: string | null, item: string): string =>
    list
      .map((nd) => {
        if (nd.type === "text") return literal(nd.value, hash, wildcard, item);
        if (nd.type === "ref") return nd.kind === "w" ? wildcardOf(hashOf(nd.id), nd.id) : "";
        const alts = nd.alts.map((alt, i) => ({ w: nd.weights[i]!, alt })).filter((a) => a.w > 0);
        return "{" + alts.map((a) => `${a.w}::` + nodes(a.alt, hash, wildcard, item)).join("|") + "}";
      })
      .join("");

  type Entry = { w: number; text: () => string };
  const pool = (hash: string, wildcard: string | null, out: Entry[]): Entry[] => {
    for (const it of docOf(hash).items) {
      if (it.ref !== undefined && it.spread === true) {
        pool(hashOf(it.ref.wildcard), it.ref.wildcard, out);
        continue;
      }
      const w = it.w ?? 1;
      if (w === 0) continue;
      if (it.ref !== undefined) {
        const target = it.ref.wildcard;
        out.push({ w, text: () => wildcardOf(hashOf(target), target) });
      } else {
        const p = parse(it.text ?? "", "stored");
        out.push({ w, text: () => (p.ok ? nodes(p.nodes, hash, wildcard, it.id) : "") });
      }
    }
    return out;
  };

  const wildcardOf = (hash: string, wildcard: string | null): string => {
    const d = docOf(hash);
    const entries = pool(hash, wildcard, []);
    if (entries.length === 0) return "";
    const [min, max] = d.select?.count ?? [1, 1];
    const sep = d.select?.sep ?? ", ";
    let prefix = "";
    if (min !== 1 || max !== 1) {
      if (/\||\$\$|[{}]/.test(sep)) warn("W_SEP", hash, wildcard);
      prefix = `${min}-${max}$$${sep}$$`;
    }
    return "{" + prefix + entries.map((e) => `${e.w}::` + e.text()).join("|") + "}";
  };

  const text = wildcardOf(b.root, options.rootWildcard ?? null);
  if (new TextEncoder().encode(text).length > IMPACT_SIZE_WARN) warn("W_SIZE", b.root, options.rootWildcard ?? null);
  return { ok: true, text, warnings };
}
