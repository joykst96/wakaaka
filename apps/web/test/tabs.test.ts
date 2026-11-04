// 탭 목록 순수 함수 (DESIGN 11절 "탭")

import { describe, expect, test } from "vitest";
import type { KeyValueStore } from "../src/lib/drafts.ts";
import { closeTab, keyOf, loadTabs, MAX_TABS, moveTab, openTab, replaceTab, routeOf, saveTabs } from "../src/lib/tabs.ts";

const A = "w:AAAAAAAAAAAA";
const B = "w:BBBBBBBBBBBB";
const C = "w:CCCCCCCCCCCC";

describe("탭 목록", () => {
  test("키와 경로", () => {
    expect(keyOf({ name: "wildcard", id: "AAAAAAAAAAAA" })).toBe(A);
    expect(keyOf({ name: "new" })).toBe("new");
    expect(keyOf({ name: "explore" })).toBeNull();
    expect(routeOf(A)).toEqual({ name: "wildcard", id: "AAAAAAAAAAAA" });
    expect(routeOf("new")).toEqual({ name: "new" });
  });

  test("열기: 이미 있으면 그대로, 없으면 끝에", () => {
    expect(openTab([A, B], A)).toEqual([A, B]);
    expect(openTab([A, B], C)).toEqual([A, B, C]);
  });

  test("상한을 넘으면 앞에서부터 지워도 되는 탭을 닫는다(저장 안 한 탭은 남긴다)", () => {
    const many = Array.from({ length: MAX_TABS }, (_, i) => "w:" + String(i).padStart(12, "0"));
    const out = openTab(many, C, (k) => k === many[0]);
    expect(out).toHaveLength(MAX_TABS);
    expect(out[0]).toBe(many[0]);
    expect(out).not.toContain(many[1]);
    expect(out.at(-1)).toBe(C);
  });

  test("닫기: 지금 탭이면 오른쪽, 없으면 왼쪽, 다 닫으면 null", () => {
    expect(closeTab([A, B, C], B, B)).toEqual({ keys: [A, C], next: C });
    expect(closeTab([A, B, C], C, C)).toEqual({ keys: [A, B], next: B });
    expect(closeTab([A, B, C], A, C)).toEqual({ keys: [B, C], next: C });
    expect(closeTab([A], A, A)).toEqual({ keys: [], next: null });
    expect(closeTab([A], B, A)).toEqual({ keys: [A], next: A });
  });

  test("바꾸기: 새 와일드카드를 저장하면 같은 자리에서 w:ID가 된다", () => {
    expect(replaceTab([A, "new", B], "new", C)).toEqual([A, C, B]);
    expect(replaceTab([A, "new", C], "new", C)).toEqual([A, C]);
    expect(replaceTab([A], "new", C)).toEqual([A, C]);
  });

  test("옮기기", () => {
    expect(moveTab([A, B, C], 0, 2)).toEqual([B, C, A]);
    expect(moveTab([A, B, C], 2, 0)).toEqual([C, A, B]);
    expect(moveTab([A, B, C], 5, 0)).toEqual([A, B, C]);
  });

  test("기억: 저장과 복원, 틀린 값은 버림", () => {
    const data = new Map<string, string>();
    const s: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
    saveTabs([A, "new", B], s);
    expect(loadTabs(s)).toEqual([A, "new", B]);
    data.set("wakaaka:tabs", JSON.stringify([A, A, "w:short", "javascript:alert(1)", 3, null, "new"]));
    expect(loadTabs(s)).toEqual([A, "new"]);
    data.set("wakaaka:tabs", "{broken");
    expect(loadTabs(s)).toEqual([]);
  });
});
