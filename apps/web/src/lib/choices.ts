// 선택지 보기 가중치 편집 보조 (DESIGN 3절 "보기 가중치", 편집기 보조).
// 텍스트의 선택지를 나열하고, 보기별 가중치를 고친 텍스트를 만든다. 위치는 파서가 준 보기 시작·가중치 끝을 쓴다.

import { MAX_WEIGHT, parse, type Node } from "@wakaaka/core";

export interface ChoiceAlt {
  /** 보기 시작(`{`·`|` 바로 뒤)과 가중치 표기 끝 */
  start: number;
  weightEnd: number;
  /** 보기 끝(다음 `|` 또는 닫는 `}` 자리) */
  end: number;
  /** 적은 가중치. 안 적었으면 undefined(= 1) */
  weight: number | undefined;
  /** 가중치를 뺀 보기 원문 */
  raw: string;
}

export interface ChoiceInfo {
  /** 전위 순서 번호(0부터) */
  index: number;
  /** 몇 겹째인지(1부터) */
  depth: number;
  start: number;
  end: number;
  alts: ChoiceAlt[];
}

/** 텍스트 안의 선택지(중첩 포함, 전위 순서). 문법 오류가 있으면 빈 목록 */
export function listChoices(text: string): ChoiceInfo[] {
  const p = parse(text, "edit");
  if (!p.ok) return [];
  const out: ChoiceInfo[] = [];
  const walk = (nodes: readonly Node[], depth: number) => {
    for (const nd of nodes) {
      if (nd.type !== "choice") continue;
      const info: ChoiceInfo = { index: out.length, depth, start: nd.start, end: nd.end, alts: [] };
      out.push(info);
      nd.alts.forEach((_, i) => {
        const start = nd.altStarts[i]!;
        const weightEnd = nd.weightEnds[i]!;
        const end = i + 1 < nd.alts.length ? nd.altStarts[i + 1]! - 1 : nd.end - 1;
        info.alts.push({ start, weightEnd, end, weight: weightEnd > start ? nd.weights[i] : undefined, raw: text.slice(weightEnd, end) });
      });
      nd.alts.forEach((alt) => walk(alt, depth + 1));
    }
  };
  walk(p.nodes, 1);
  return out;
}

/**
 * 선택지 하나의 보기 가중치를 바꾼 텍스트. undefined는 표기를 지운다(= 1).
 * 단, 보기 원문이 `숫자*`로 시작하면 지우는 대신 `1*`을 남긴다(지우면 그 글자가 가중치로 읽힌다).
 */
export function setChoiceWeights(text: string, choice: ChoiceInfo, weights: ReadonlyArray<number | undefined>): string {
  let out = text;
  for (let i = choice.alts.length - 1; i >= 0; i--) {
    const alt = choice.alts[i]!;
    const w = weights[i];
    const mark = w !== undefined ? `${w}*` : /^[0-9.]+\*/.test(alt.raw) ? "1*" : "";
    out = out.slice(0, alt.start) + mark + out.slice(alt.weightEnd);
  }
  return out;
}

/** 가중치 칸 입력 → 값. 빈칸은 undefined(1), 틀리면 null */
export function parseWeightInput(s: string): number | undefined | null {
  const t = s.trim();
  if (t === "") return undefined;
  if (!/^[0-9]{1,7}$/.test(t) || Number(t) > MAX_WEIGHT) return null;
  return Number(t);
}

/** 보기마다 뽑힐 확률(%). 모두 0이면 null */
export function choicePercents(weights: ReadonlyArray<number | undefined>): number[] | null {
  const ws = weights.map((w) => w ?? 1);
  const sum = ws.reduce((a, b) => a + b, 0);
  return sum === 0 ? null : ws.map((w) => (w / sum) * 100);
}
