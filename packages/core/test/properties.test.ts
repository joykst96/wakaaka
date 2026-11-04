// SPEC 4.3 성질을 공통 테스트 세트의 모든 사례와 seed에서 검사한다 (check.py가 참조 모델에 하는 것과 같은 변형).

import { describe, expect, test } from "vitest";
import { expand, type ExpandResult, type TraceEvent } from "../src/expand.ts";
import { parse, type Node } from "../src/parser.ts";
import { loadExpandCases, type ExpandCase } from "./conformance.ts";

const cases = loadExpandCases();

type Mutate = (doc: any) => boolean; // 문서를 고쳤으면 true

/** 묶음의 모든 문서에 mutate를 적용한 사본. 고친 문서 수도 돌려준다. */
function variant(bundle: any, mutate: Mutate): { bundle: any; changed: number } {
  const b = structuredClone(bundle);
  let changed = 0;
  if (b && typeof b.docs === "object" && b.docs !== null) {
    for (const doc of Object.values(b.docs)) {
      if (doc && typeof doc === "object" && Array.isArray((doc as any).items) && mutate(doc)) changed++;
    }
  }
  return { bundle: b, changed };
}

function outcome(r: ExpandResult) {
  return r.ok ? { text: r.text } : { error: r.error.code };
}

function runAll(c: ExpandCase, bundle: any, seed: string) {
  const trace: TraceEvent[] = [];
  const r = expand(bundle, seed, { limits: c.limits ?? {}, trace: (e) => trace.push(e) });
  return { r: outcome(r), trace };
}

const reverseItems: Mutate = (doc) => {
  if (doc.items.length < 2) return false;
  doc.items.reverse();
  return true;
};

/** spread가 아닌 ref 항목을 인라인 참조 텍스트로. w는 그대로 두고 spread 키는 뺀다(text 항목에는 쓸 수 없다). */
const refToInline: Mutate = (doc) => {
  let changed = false;
  doc.items = doc.items.map((it: any) => {
    const ref = it?.ref;
    const plainRef = ref && typeof ref === "object" && Object.keys(ref).length === 1 && typeof ref.wildcard === "string";
    if (!plainRef || it.spread === true) return it;
    changed = true;
    const { ref: _r, spread: _s, ...rest } = it;
    return { ...rest, text: "${w:" + ref.wildcard + "}" };
  });
  return changed;
};

/** 모든 텍스트 끝에 글자를 덧붙인다. 노드 번호와 뽑기는 그대로여야 한다. */
const appendText: Mutate = (doc) => {
  let changed = false;
  for (const it of doc.items) {
    if (it && typeof it.text === "string") {
      it.text += "Q";
      changed = true;
    }
  }
  return changed;
};

/** 가중치를 적지 않은 모든 선택지 보기 맨 앞에 1*을 넣는다(파서가 준 보기 시작 위치로). 문법 오류가 있는 텍스트는 그대로 */
export function addOneWeights(text: string): string {
  const p = parse(text, "edit");
  if (!p.ok) return text;
  const at: number[] = [];
  const walk = (nodes: readonly Node[]) => {
    for (const nd of nodes) {
      if (nd.type !== "choice") continue;
      nd.altStarts.forEach((s, i) => nd.weightEnds[i] === s && at.push(s));
      nd.alts.forEach(walk);
    }
  };
  walk(p.nodes);
  let out = text;
  for (const s of at.sort((a, b) => b - a)) out = out.slice(0, s) + "1*" + out.slice(s);
  return out;
}

const explicitOnes: Mutate = (doc) => {
  let changed = false;
  for (const it of doc.items) {
    if (it && typeof it.text === "string") {
      const t = addOneWeights(it.text);
      if (t !== it.text) (it.text = t), (changed = true);
    }
  }
  return changed;
};

describe("SPEC 4.3 성질 (모든 공통 사례)", () => {
  test("5. 선택지의 모든 보기에 가중치 1을 적어도 결과가 같다", () => {
    expect(addOneWeights("{a|{b|c}} x {|} {3*d|e}")).toBe("{1*a|1*{1*b|1*c}} x {1*|1*} {3*d|1*e}");
    let compared = 0;
    for (const c of cases) {
      const v = variant(c.bundle, explicitOnes);
      if (v.changed === 0) continue;
      for (const run of c.runs) {
        expect(runAll(c, v.bundle, run.seed).r, `${c.file} seed ${run.seed}`).toEqual(runAll(c, c.bundle, run.seed).r);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  test("3. 항목 순서는 결과와 무관하다", () => {
    let compared = 0;
    for (const c of cases) {
      const v = variant(c.bundle, reverseItems);
      if (v.changed === 0) continue;
      for (const run of c.runs) {
        expect(runAll(c, v.bundle, run.seed).r, `${c.file} seed ${run.seed}`).toEqual(runAll(c, c.bundle, run.seed).r);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  test("1. ref 항목과 인라인 참조는 같다", () => {
    let compared = 0;
    for (const c of cases) {
      const v = variant(c.bundle, refToInline);
      if (v.changed === 0) continue;
      for (const run of c.runs) {
        expect(runAll(c, v.bundle, run.seed).r, `${c.file} seed ${run.seed}`).toEqual(runAll(c, c.bundle, run.seed).r);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });

  test("2. 텍스트를 고쳐도 뽑기와 선택 기록이 같다", () => {
    let compared = 0;
    for (const c of cases) {
      const v = variant(c.bundle, appendText);
      if (v.changed === 0) continue;
      for (const run of c.runs) {
        const a = runAll(c, c.bundle, run.seed);
        const b = runAll(c, v.bundle, run.seed);
        expect(b.trace, `${c.file} seed ${run.seed}`).toEqual(a.trace);
        expect("error" in b.r ? b.r.error : "ok").toBe("error" in a.r ? a.r.error : "ok");
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(150);
  });
});
