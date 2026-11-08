// 토스트 목록 규칙 (DESIGN 11절 "토스트")

import { describe, expect, test } from "vitest";
import { dropToast, pushToast, roleOf, TOAST_MAX, TOAST_MS, type Toast } from "../src/lib/toasts.ts";

describe("토스트", () => {
  test("쌓이고, 기본 종류는 info", () => {
    let l: Toast[] = [];
    l = pushToast(l, { text: "a" }, 1);
    l = pushToast(l, { kind: "success", text: "b" }, 2);
    expect(l).toEqual([
      { id: 1, kind: "info", text: "a" },
      { id: 2, kind: "success", text: "b" },
    ]);
  });

  test("같은 글은 겹쳐 쌓지 않고 맨 아래로 옮겨 새 id(시간을 다시 센다)", () => {
    let l: Toast[] = [];
    l = pushToast(l, { kind: "success", text: "ID를 복사했습니다" }, 1);
    l = pushToast(l, { text: "저장했습니다" }, 2);
    l = pushToast(l, { kind: "success", text: "ID를 복사했습니다" }, 3);
    expect(l.map((t) => [t.id, t.text])).toEqual([
      [2, "저장했습니다"],
      [3, "ID를 복사했습니다"],
    ]);
    // 글이 같아도 종류가 다르면 다른 토스트
    l = pushToast(l, { kind: "error", text: "저장했습니다" }, 4);
    expect(l).toHaveLength(3);
  });

  test("최대 개수를 넘으면 오래된 것부터 뺀다", () => {
    let l: Toast[] = [];
    for (let i = 1; i <= TOAST_MAX + 2; i++) l = pushToast(l, { text: `t${i}` }, i);
    expect(l.map((t) => t.id)).toEqual(Array.from({ length: TOAST_MAX }, (_, k) => k + 3));
  });

  test("닫기와 읽기 방식, 시간", () => {
    const l = pushToast(pushToast([], { text: "a" }, 1), { text: "b" }, 2);
    expect(dropToast(l, 1).map((t) => t.id)).toEqual([2]);
    expect(dropToast(l, 9)).toEqual(l);
    expect(roleOf("error")).toBe("alert");
    for (const k of ["info", "success", "warning"] as const) expect(roleOf(k)).toBe("status");
    expect(TOAST_MS).toBe(3000);
  });
});
