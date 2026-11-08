// Impact Pack 내보내기 (DESIGN 11절). 분포가 같다는 것은 실제 Impact process()로 따로 확인했다(NOTES).
// 여기서는 변환 모양, 경고, 오류 전달을 본다.

import { describe, expect, test } from "vitest";
import { toImpactPrompt } from "../src/export.ts";

const bundle = (items: unknown[], extra: Record<string, unknown> = {}, docs: Record<string, unknown> = {}, lock: Record<string, string> = {}) => ({
  format: 1,
  root: "root00000000",
  lock,
  docs: { root00000000: { schema: 1, items, ...extra }, ...docs },
});
const text = (b: unknown, rootWildcard?: string) => {
  const r = toImpactPrompt(b, rootWildcard ? { rootWildcard } : {});
  if (!r.ok) throw new Error(r.error.code);
  return r;
};

describe("변환 모양", () => {
  test("항목 가중치를 모든 보기에 적고, 0은 뺀다", () => {
    expect(text(bundle([{ id: "a", text: "red", w: 3 }, { id: "b", text: "blue" }, { id: "c", text: "green", w: 0 }, { id: "d", text: "" }])).text).toBe("{3::red|1::blue|1::}");
  });
  test("개수와 구분자", () => {
    expect(text(bundle([{ id: "a", text: "x" }, { id: "b", text: "y" }], { select: { count: [0, 2], sep: " and " } })).text).toBe("{0-2$$ and $$1::x|1::y}");
    expect(text(bundle([{ id: "a", text: "x" }], { select: { count: [1, 1], sep: " | " } })).text).toBe("{1::x}");
  });
  test("선택지 가중치와 중첩, 0인 보기는 뺀다", () => {
    expect(text(bundle([{ id: "a", text: "{3*long|short|0*no} {a|{b|2*c}}" }])).text).toBe("{1::{3::long|1::short} {1::a|1::{1::b|2::c}}}");
  });
  test("참조는 그 자리에 펼치고, 펼친 참조는 같은 목록에", () => {
    const b = bundle(
      [
        { id: "a", text: "${w:XXXXXXXXXXXX} hair" },
        { id: "b", ref: { wildcard: "XXXXXXXXXXXX" }, w: 2 },
        { id: "c", ref: { wildcard: "YYYYYYYYYYYY" }, spread: true },
      ],
      {},
      { xdoc00000001: { schema: 1, items: [{ id: "x", text: "red" }, { id: "y", text: "blue" }] }, ydoc00000001: { schema: 1, items: [{ id: "p", text: "pony", w: 3 }, { id: "q", text: "none", w: 0 }] } },
      { XXXXXXXXXXXX: "xdoc00000001", YYYYYYYYYYYY: "ydoc00000001" },
    );
    expect(text(b).text).toBe("{1::{1::red|1::blue} hair|2::{1::red|1::blue}|3::pony}");
  });
  test("빈 와일드카드와 참조된 빈 와일드카드는 빈 글자", () => {
    expect(text(bundle([])).text).toBe("");
    const b = bundle([{ id: "a", text: "x ${w:XXXXXXXXXXXX} y" }], {}, { xdoc00000001: { schema: 1, items: [] } }, { XXXXXXXXXXXX: "xdoc00000001" });
    expect(text(b).text).toBe("{1::x  y}");
  });
  test("NAI 강조로 시작하는 보기도 앞에 가중치가 붙어 Impact가 떼지 않는다", () => {
    expect(text(bundle([{ id: "a", text: "2::red hair::" }, { id: "b", text: "{1.2::wlop ::|x}" }])).text).toBe("{1::2::red hair::|1::{1::1.2::wlop ::|1::x}}");
  });
  test("주석 항목(SPEC 2.7)은 빼고, 맨 앞 \\#은 글자 #. 주석만 있는 와일드카드는 빈 글자", () => {
    const b = bundle(
      [
        { id: "a", text: "# 메모 {깨진 ${w:ZZZZZZZZZZZZ}" },
        { id: "b", text: "\\#compass", w: 2 },
        { id: "c", text: "x ${w:XXXXXXXXXXXX} #y" },
        { id: "d", ref: { wildcard: "XXXXXXXXXXXX" }, spread: true },
      ],
      {},
      { xdoc00000001: { schema: 1, items: [{ id: "n", text: "#only notes" }] } },
      { XXXXXXXXXXXX: "xdoc00000001" },
    );
    expect(text(b).text).toBe("{2::#compass|1::x  #y}");
    expect(text(bundle([{ id: "a", text: "#a" }, { id: "b", text: "#b", w: 0 }])).text).toBe("");
  });
  test("$ 하나와 와카아카 이스케이프는 글자로 풀린다", () => {
    expect(text(bundle([{ id: "a", text: "100\\$, \\\\m/, hatsune miku \\(cosplay\\)" }])).text).toBe("{1::100$, \\m/, hatsune miku \\(cosplay\\)}");
  });
});

describe("경고", () => {
  const codes = (b: unknown) => text(b, "ROOTrootROOT").warnings.map((w) => [w.code, w.wildcard, w.item ?? null]);
  test("글자 | (태그 :|), 글자 { } (\\{로 바꿈), $$, __이름__, 줄바꿈", () => {
    const r = text(bundle([{ id: "a", text: ":|" }, { id: "b", text: "\\{x\\}" }, { id: "c", text: "a$$b __hair__" }, { id: "d", text: "l1\n#l2" }]), "ROOTrootROOT");
    expect(r.text).toBe("{1:::||1::\\{x\\}|1::a$$b __hair__|1::l1 #l2}");
    expect(r.warnings.map((w) => [w.code, w.item])).toEqual([
      ["W_PIPE", "a"],
      ["W_BRACE", "b"],
      ["W_DOLLARS", "c"],
      ["W_WILDCARD_FILE", "c"],
      ["W_NEWLINE", "d"],
    ]);
  });
  test("선택지 안의 \\| 도 글자 | 라서 경고", () => {
    expect(codes(bundle([{ id: "a", text: "{\\||/}" }]))).toEqual([["W_PIPE", "ROOTrootROOT", "a"]]);
  });
  test("구분자의 | 는 개수가 있을 때만 경고", () => {
    expect(codes(bundle([{ id: "a", text: "x" }], { select: { count: [1, 2], sep: " | " } }))).toEqual([["W_SEP", "ROOTrootROOT", null]]);
    expect(codes(bundle([{ id: "a", text: "x" }], { select: { sep: " | " } }))).toEqual([]);
  });
  test("하위 와일드카드의 경고는 그 와일드카드 ID로, 같은 곳은 한 번만", () => {
    const b = bundle(
      [{ id: "a", text: "${w:XXXXXXXXXXXX} ${w:XXXXXXXXXXXX}" }],
      {},
      { xdoc00000001: { schema: 1, items: [{ id: "x", text: ":|" }] } },
      { XXXXXXXXXXXX: "xdoc00000001" },
    );
    expect(codes(b)).toEqual([["W_PIPE", "XXXXXXXXXXXX", "x"]]);
  });
  test("100KB를 넘으면 W_SIZE", () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: "i" + i, text: "x".repeat(40) }));
    expect(text(bundle(big)).warnings.map((w) => w.code)).toEqual(["W_SIZE"]);
  });
});

describe("오류", () => {
  test("전개할 수 없는 묶음은 그 오류", () => {
    const r = toImpactPrompt(bundle([{ id: "a", text: "${w:XXXXXXXXXXXX}" }]));
    expect(r.ok ? "ok" : r.error.code).toBe("E_UNRESOLVED");
    expect(toImpactPrompt({ format: 2 }).ok).toBe(false);
  });
  test("전개 횟수 상한(seed마다 다름)만은 변환한다", () => {
    // 항목 하나가 하위를 두 번 부르는 문서를 쌓아 seed 0에서 E_BUDGET이 나게 한다
    const docs: Record<string, unknown> = {};
    const lock: Record<string, string> = {};
    for (let d = 0; d < 14; d++) {
      const id = ("W" + d).padEnd(12, "w");
      const hash = ("h" + d).padEnd(12, "h");
      lock[id] = hash;
      const next = ("W" + (d + 1)).padEnd(12, "w");
      docs[hash] = { schema: 1, items: [{ id: "a", text: d === 13 ? "leaf" : "${w:" + next + "} ${w:" + next + "}" }] };
    }
    const b = { format: 1, root: lock[("W" + 0).padEnd(12, "w")]!, lock, docs };
    const r = toImpactPrompt(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.split("leaf").length - 1).toBe(2 ** 13);
  });
});
