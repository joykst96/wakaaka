// 문법 가이드의 단계와 예시 (SPEC 2절 문법, 4절 전개, DESIGN 11절 편집기).
// 예시 결과는 손으로 쓰지 않고 core expand로 전개해서 보여 준다. 그래서 가이드가 실제 동작과 어긋날 수 없다(test/guide.test.ts).

import { expand, type Doc } from "@wakaaka/core";
import { parseLine } from "./textview.ts";

export interface GuideExample {
  /** 편집기에 쓰는 모양 그대로 (텍스트 보기 줄 형식) */
  code: string;
  /** 참조 예시에 쓰는 가짜 와일드카드: 이름 → 텍스트 보기 줄 */
  refs?: Record<string, string>;
  /** 펼친 참조로 넣을 이름 (펼치기 예시) */
  spread?: string[];
  count?: [number, number];
  sep?: string;
  caption?: string;
}

export interface GuideStep {
  title: string;
  /** 문단들. `코드`는 백틱으로 감싼다(화면에서 code로 그린다) */
  body: string[];
  examples: GuideExample[];
}

export const GUIDE: GuideStep[] = [
  {
    title: "항목과 뽑기",
    body: [
      "와일드카드는 후보(항목) 목록이다. 한 줄(목록 보기의 한 행)이 항목 하나다.",
      "전개할 때 개수만큼 가중치에 비례해 중복 없이 뽑고, 뽑힌 순서대로 구분자로 잇는다. 가중치 칸을 비우면 1, 0이면 뽑히지 않는다.",
      "항목 순서는 결과와 상관없다. 끌어서 옮겨도 같은 seed의 결과가 그대로다.",
    ],
    examples: [{ code: "red hair\nblue hair\n3* black hair", caption: "black hair가 다른 둘보다 3배 자주 나온다 (`3*`는 텍스트 보기의 가중치 표기)" }],
  },
  {
    title: "개수와 구분자",
    body: ["편집기 위쪽의 개수(최소~최대)와 구분자로 정한다. 기본은 1~1개, 구분자 `, `.", "개수가 항목 수보다 크면 항목 수까지만 뽑는다."],
    examples: [{ code: "smile\nblush\nopen mouth\nclosed eyes", count: [1, 3], caption: "1~3개를 뽑아 `, `로 잇는다" }],
  },
  {
    title: "즉석 선택지 { | }",
    body: [
      "`{a|b|c}`는 보기 하나를 고른다(가중치를 안 쓰면 같은 확률). 와일드카드를 따로 만들 만큼은 아닌 작은 갈래에 쓴다. 보기마다 확률을 다르게 하려면 6단계.",
      "빈 보기도 된다: `{|smile}`은 절반은 아무것도 안 나온다. 선택지 안에 선택지나 참조를 넣을 수 있다.",
    ],
    examples: [
      { code: "{red|blue|black} hair" },
      { code: "1girl, {|smile}, standing", caption: "빈 보기가 뽑혀 생긴 `, ,`는 마지막에 정리된다" },
      { code: "{long|short} {straight|{wavy|curly}} hair", caption: "중첩: wavy와 curly는 각각 1/4" },
    ],
  },
  {
    title: "참조 ${이름}",
    body: [
      "`${`를 치면 자동완성이 뜬다(내 것 → 즐겨찾기 → 둘러보기). 고르면 이름이 붙은 칩이 된다. 칩을 누르면 그 와일드카드로 간다.",
      "이름을 직접 쳐도 된다. 저장할 때 내 와일드카드의 같은 이름(대소문자 무시)으로 바꾸고, 내 것에 없으면 고르는 창이 뜬다.",
      "남의 와일드카드를 고르면 가져오기 확인 뒤 의존성까지 내 와일드카드로 복사해서 넣는다. 원작자가 나중에 고쳐도 내 쪽은 바뀌지 않는다.",
    ],
    examples: [
      {
        code: "1girl, ${hair color}, ${eye color}",
        refs: { "hair color": "red hair\nsilver hair\nblack hair", "eye color": "blue eyes\ngreen eyes" },
      },
    ],
  },
  {
    title: "펼치기",
    body: [
      "항목 전체가 참조 하나인 행(목록 보기에서 칩만 있는 행)에는 펼치기 체크가 있다.",
      "끄면(기본) 참조한 와일드카드 전체가 후보 하나다. 켜면 그 와일드카드의 항목들이 이 목록의 후보로 들어온다. 펼친 항목은 자기 가중치를 쓰고 그쪽의 개수·구분자는 무시한다.",
    ],
    examples: [
      { code: "bald", spread: ["hair color"], refs: { "hair color": "red hair\nsilver hair\nblack hair" }, caption: "펼치면 후보가 4개(bald + 머리색 3개). 펼치지 않으면 2개(bald, 머리색 하나)" },
    ],
  },
  {
    title: "보기 가중치 {3*a|b}",
    body: [
      "선택지 보기 맨 앞에 `정수*`를 쓰면 그 비율로 고른다. `{3*silver|platinum}`은 silver 3 : platinum 1이다. 안 쓴 보기는 1, `0*`은 뽑히지 않는다.",
      "목록 보기에서 선택지가 있는 항목 오른쪽의 ⚖ 버튼을 누르면 보기마다 가중치 칸과 확률이 나온다. 칸에 숫자를 넣으면 `3*` 표기를 대신 써 준다.",
      "가중치는 0~1,000,000 정수다. 소수(`1.5*`)나 모든 보기 0은 오류다. `{ 3*a}`처럼 앞에 공백이 있으면 가중치가 아니라 글자다. 글자 `3*x`로 시작하는 보기는 `{1*3*x}`로 쓴다.",
      "Impact Pack의 `{3::a|b}` 표기는 쓰지 않는다(`::`는 NAI 강조와 겹친다). 그렇게 쓰면 편집기가 `3*`로 안내한다. 같은 보기 묶음을 여러 곳에서 쓰면 와일드카드로 만들어 항목 가중치를 주는 편이 낫다.",
    ],
    examples: [
      { code: "{3*silver|platinum} hair", caption: "silver 3 : platinum 1" },
      { code: "{5*smile|2*grin|0*frown}", caption: "frown은 가중치 0이라 나오지 않는다" },
      { code: "${hair tint} hair", refs: { "hair tint": "3* silver\nplatinum" }, caption: "와일드카드의 항목 가중치로도 같은 비율(여러 곳에서 다시 쓸 때)" },
    ],
  },
  {
    title: "글자 그대로 쓰기 (이스케이프)",
    body: [
      "`{` `}` `$` `\\` 앞에 `\\`를 붙이면 글자 그대로 나온다. 선택지 안에서는 `\\|`도 된다.",
      "그 밖의 백슬래시는 그대로 남는다. ComfyUI 괄호 `\\(` `\\)`, 태그 `\\m/`는 고칠 필요가 없다.",
      "주석 문법은 없다(`#`, `//`는 태그와 겹친다). 메모는 설명 칸에 쓴다.",
    ],
    examples: [{ code: "\\{literal braces\\}, 100\\$, hatsune miku \\(cosplay\\)" }, { code: "{:\\||\\m/}", caption: "선택지 안의 세로선 이모티콘 `:|`" }],
  },
  {
    title: "텍스트 보기",
    body: [
      "한 줄에 항목 하나로 한꺼번에 고칠 때 쓴다. `3* red hair`는 가중치 3, `*`만 쓰면 빈 항목, `* 3*x`는 가중치 없이 글자 `3*x`다. 빈 줄은 항목이 아니다(예전 `3::` 표기는 이제 글자로 남는다).",
      "목록 보기로 돌아가면 줄을 비교해서 바뀌지 않은 줄과 같은 자리에서 고친 줄은 원래 항목 ID를 유지한다. 항목 ID는 seed 결과에 들어가므로, 한 줄을 고쳐도 다른 줄의 뽑기는 그대로다.",
      "Ctrl+S로 저장한다. 저장하지 않은 내용은 이 브라우저에 임시 보관된다.",
    ],
    examples: [{ code: "2* smile\n*\nlaughing", caption: "빈 항목(`*`)이 '아무것도 안 나옴' 보기가 된다" }],
  },
  {
    title: "편집기 색 읽기",
    body: [
      "선택지 기호 `{` `|` `}`는 겹마다 색이 바뀐다(1겹 주황, 2겹 초록, 3겹 파랑, 4겹부터 다시). 짝이 맞는 괄호는 같은 색이다.",
      "참조는 이름이 붙은 칩으로, 아직 저장하지 않은 이름 참조 `${이름}`은 파란 글자로 보인다. 보기 가중치 `3*`와 텍스트 보기 줄 맨 앞의 가중치도 파란색이다.",
      "흐린 회색은 와카아카가 해석하지 않고 그대로 넘기는 표기다: ComfyUI 강조 `(tag:1.2)`, `<lora:…>`, NAI 숫자 강조 `1.2::…::`, `BREAK`. 결과 문자열에 그대로 들어간다.",
      "빨간 물결 밑줄은 저장할 수 없는 문법 오류(닫히지 않은 `{` 등), 점선 밑줄은 저장할 때 고를 이름 참조다.",
    ],
    examples: [
      {
        code: "{red|{3*silver|platinum}} hair, ${hair color}, (smile:1.1), <lora:detail:0.6>",
        refs: { "hair color": "black hair\nblonde hair" },
        caption: "ComfyUI·LoRA 표기는 결과에 그대로 남는다",
      },
    ],
  },
];

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const fakeId = (n: number, prefix: string) => (prefix + "x".repeat(12)).slice(0, 10) + B62[Math.floor(n / 62)]! + B62[n % 62]!;

function linesToItems(code: string, idPrefix: string): Doc["items"] {
  return code.split("\n").map((line, i) => {
    const p = parseLine(line);
    const it: Doc["items"][number] = { id: idPrefix + B62[i]!, text: p.text };
    if (p.w !== undefined) it.w = p.w;
    return it;
  });
}

/** 예시를 전개할 묶음. 이름 참조는 가짜 ID로 바꾼다 */
export function exampleBundle(ex: GuideExample) {
  const names = Object.keys(ex.refs ?? {});
  const idOf = new Map(names.map((n, i) => [n, fakeId(i, "guideRef")]));
  const hashOf = new Map(names.map((n, i) => [n, fakeId(i, "guideDoc")]));
  const toStored = (code: string) => code.replace(/\$\{([^}]*)\}/g, (m, n: string) => (idOf.has(n) ? "${w:" + idOf.get(n) + "}" : m));
  const root: Doc = { schema: 1, items: linesToItems(toStored(ex.code), "r") };
  for (const [i, n] of (ex.spread ?? []).entries()) root.items.push({ id: "s" + B62[i]!, ref: { wildcard: idOf.get(n)! }, spread: true });
  if (ex.count || ex.sep !== undefined) root.select = { ...(ex.count ? { count: ex.count } : {}), ...(ex.sep !== undefined ? { sep: ex.sep } : {}) };
  const docs: Record<string, Doc> = { guideRoot000: root };
  const lock: Record<string, string> = {};
  for (const n of names) {
    docs[hashOf.get(n)!] = { schema: 1, name: n, items: linesToItems(ex.refs![n]!, "c") };
    lock[idOf.get(n)!] = hashOf.get(n)!;
  }
  return { format: 1 as const, root: "guideRoot000", lock, docs };
}

/** seed 0부터 차례로 전개해 서로 다른 결과를 최대 limit개 (빈 결과는 "(빈 결과)") */
export function exampleOutputs(ex: GuideExample, limit = 5, tries = 40): string[] {
  const b = exampleBundle(ex);
  const out: string[] = [];
  for (let s = 0; s < tries && out.length < limit; s++) {
    const r = expand(b, BigInt(s));
    if (!r.ok) return [`(오류 ${r.error.code})`];
    const t = r.text === "" ? "(빈 결과)" : r.text;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
