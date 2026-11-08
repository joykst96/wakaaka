// 폴더 묶기, 이름 검사, 접은 폴더 기억, 폴더 정리 경로 (DESIGN 11절 "폴더")

import { describe, expect, test } from "vitest";
import type { Folder } from "../src/lib/api.ts";
import type { KeyValueStore } from "../src/lib/drafts.ts";
import { ApiError } from "../src/lib/api.ts";
import {
  checkFolderName,
  dragSet,
  folderCount,
  folderErrorMessage,
  folderIndex,
  groupByFolder,
  loadCollapsed,
  moveLocally,
  needsMove,
  newFolderAfter,
  parseDropTarget,
  parseMenuTarget,
  saveCollapsed,
} from "../src/lib/folders.ts";
import { hrefOf, parseRoute } from "../src/lib/routes.ts";

const F = (id: string, name: string, wildcards: string[]): Folder => ({ id: id.padEnd(12, "0"), name, wildcards });
const w = (id: string) => ({ id, name: id });

describe("폴더별로 나누기", () => {
  test("폴더가 없으면 전부 '폴더 없음'이고 순서가 그대로다", () => {
    const list = ["a", "b", "c"].map(w);
    expect(groupByFolder(list, [])).toEqual({ folders: [], loose: list });
  });

  test("폴더 순서는 서버 순서, 폴더 안은 목록 순서, 빈 폴더도 나온다", () => {
    const list = ["a", "b", "c", "d", "e"].map(w);
    const f1 = F("f1", "배경", ["d", "a"]);
    const f2 = F("f2", "빈 폴더", []);
    const f3 = F("f3", "인물", ["c"]);
    const g = groupByFolder(list, [f1, f2, f3]);
    expect(g.folders.map((x) => [x.folder.name, x.items.map((i) => i.id)])).toEqual([
      ["배경", ["a", "d"]],
      ["빈 폴더", []],
      ["인물", ["c"]],
    ]);
    expect(g.loose.map((i) => i.id)).toEqual(["b", "e"]);
  });

  test("목록에 없는 ID(지웠거나 걸러진 것)는 건너뛰고, 목록은 하나도 빠지지 않는다", () => {
    const list = ["a", "b"].map(w);
    const g = groupByFolder(list, [F("f1", "x", ["a", "gone"])]);
    expect(g.folders[0]!.items.map((i) => i.id)).toEqual(["a"]);
    expect(g.loose.map((i) => i.id)).toEqual(["b"]);
    expect(folderIndex([F("f1", "x", ["a"])]).get("a")?.name).toBe("x");
  });
});

describe("폴더 이름 검사", () => {
  const folders = [F("f1", "Chars", [])];
  test("앞뒤 공백은 지워 주고, 빈 이름·제어문자·65자는 막는다", () => {
    expect(checkFolderName("  배경  ", folders)).toEqual({ name: "배경" });
    for (const s of ["", "   ", "a\nb", "a\tb", "a\u0000", "a\u007f", "\ud800", "x".repeat(65)]) expect("error" in checkFolderName(s, folders), JSON.stringify(s)).toBe(true);
    expect(checkFolderName("😀".repeat(64), folders)).toEqual({ name: "😀".repeat(64) });
    expect(checkFolderName("{ } $ | = :", folders)).toEqual({ name: "{ } $ | = :" });
  });

  test("겹침은 대소문자 무시. 이름을 바꾸는 폴더 자신은 빼고 본다", () => {
    expect(checkFolderName("chars", folders)).toEqual({ error: "같은 이름의 폴더가 있습니다." });
    expect(checkFolderName("CHARS", folders, folders[0]!.id)).toEqual({ name: "CHARS" });
  });
});

describe("접은 폴더 기억", () => {
  const mem = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };
  test("저장하고 다시 읽는다. 비면 지운다", () => {
    const s = mem();
    saveCollapsed(new Set(["bbbbbbbbbbbb", "aaaaaaaaaaaa"]), s);
    expect([...loadCollapsed(s)]).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    saveCollapsed(new Set(), s);
    expect(s.data.size).toBe(0);
  });
  test("깨진 값, 형식이 틀린 ID, 저장소가 없거나 막힘은 모두 펼친 것으로", () => {
    const s = mem();
    for (const v of ["{", '"x"', '[1,"short","aaaaaaaaaaaa"]', '{"__proto__":1}']) {
      s.data.set("wakaaka:folders-collapsed", v);
      expect([...loadCollapsed(s)], v).toEqual(v.includes("aaaaaaaaaaaa") ? ["aaaaaaaaaaaa"] : []);
    }
    expect(loadCollapsed(null).size).toBe(0);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(loadCollapsed(broken).size).toBe(0);
    expect(() => saveCollapsed(new Set(["aaaaaaaaaaaa"]), broken)).not.toThrow();
  });
});

describe("폴더 정리 경로 (DESIGN 9절 7항)", () => {
  test("경로 해석: 전체, 폴더 없음, 폴더 ID. 형식이 틀리면 notFound", () => {
    expect(parseRoute("/folders")).toEqual({ name: "folders" });
    expect(parseRoute("/folders/none")).toEqual({ name: "folders", folder: "none" });
    expect(parseRoute("/folders/abcdefghijkl")).toEqual({ name: "folders", folder: "abcdefghijkl" });
    for (const p of ["/folders/short", "/folders/abcdefghijkl/x", "/folders/javascript:alert(1)", "/folders/"]) expect(parseRoute(p), p).toEqual({ name: "notFound" });
  });
  test("href는 검증한 ID로만, 아니면 /folders", () => {
    expect(hrefOf({ name: "folders" })).toBe("/folders");
    expect(hrefOf({ name: "folders", folder: "none" })).toBe("/folders/none");
    expect(hrefOf({ name: "folders", folder: "abcdefghijkl" })).toBe("/folders/abcdefghijkl");
    for (const folder of ["javascript:alert(1)", "//evil.example", "abcdefghijkl/../x", ""]) expect(hrefOf({ name: "folders", folder }), folder).toBe("/folders");
  });
});

// 우클릭 메뉴와 끌어 놓기 (사용자 결정 2026-11-09, DESIGN 11절 "우클릭 메뉴", "끌어 놓기")
describe("우클릭 메뉴: 새 폴더 자리", () => {
  const f1 = F("f1", "배경", ["aaaaaaaaaaaa"]);
  const f2 = F("f2", "인물", ["bbbbbbbbbbbb", "cccccccccccc"]);
  const f3 = F("f3", "빈 폴더", []);
  const all = [f1, f2, f3];

  test("data-folder-menu 값 읽기: 모르는 값은 null", () => {
    expect(parseMenuTarget("end")).toEqual({ kind: "end" });
    expect(parseMenuTarget("folder:" + f1.id)).toEqual({ kind: "folder", id: f1.id });
    expect(parseMenuTarget("wildcard:aaaaaaaaaaaa")).toEqual({ kind: "wildcard", id: "aaaaaaaaaaaa" });
    for (const v of [null, undefined, "", "folder:", "folder:short", "wildcard:aaaaaaaaaaaa/x", "x:aaaaaaaaaaaa", "END"]) expect(parseMenuTarget(v), String(v)).toBeNull();
  });

  test("폴더 위면 그 폴더 바로 다음(맨 끝 폴더도 그 다음 = 맨 끝)", () => {
    expect(newFolderAfter({ kind: "folder", id: f1.id }, all)).toBe(f1.id);
    expect(newFolderAfter({ kind: "folder", id: f3.id }, all)).toBe(f3.id);
  });

  test("폴더 안의 와일드카드 위면 그 와일드카드가 든 폴더 다음", () => {
    expect(newFolderAfter({ kind: "wildcard", id: "cccccccccccc" }, all)).toBe(f2.id);
    expect(newFolderAfter({ kind: "wildcard", id: "aaaaaaaaaaaa" }, all)).toBe(f1.id);
  });

  test("'폴더 없음'인 와일드카드, 빈 곳, 사라진 폴더면 맨 끝(undefined)", () => {
    expect(newFolderAfter({ kind: "wildcard", id: "zzzzzzzzzzzz" }, all)).toBeUndefined();
    expect(newFolderAfter({ kind: "end" }, all)).toBeUndefined();
    expect(newFolderAfter({ kind: "folder", id: "gonegonegone" }, all)).toBeUndefined();
    expect(newFolderAfter({ kind: "end" }, [])).toBeUndefined();
  });

  test("지우기 확인의 개수는 폴더에 든 수", () => {
    expect(folderCount(f2)).toBe(2);
    expect(folderCount(f3)).toBe(0);
  });
});

describe("끌어 놓기", () => {
  const A = "aaaaaaaaaaaa";
  const B = "bbbbbbbbbbbb";
  const C = "cccccccccccc";
  const f1 = F("f1", "배경", [A]);
  const f2 = F("f2", "인물", [B]);

  test("data-drop 값 읽기: 폴더 ID, none = 폴더 없음(null), 모르는 값 undefined", () => {
    expect(parseDropTarget(f1.id)).toBe(f1.id);
    expect(parseDropTarget("none")).toBeNull();
    for (const v of [undefined, null, "", "short", "NONE", f1.id + "x"]) expect(parseDropTarget(v), String(v)).toBeUndefined();
  });

  test("고른 것 중 하나를 끌면 고른 것 전부(보이는 순서), 아니면 그것 하나", () => {
    const shown = [A, B, C];
    expect(dragSet(B, new Set([C, B]), shown)).toEqual([B, C]);
    expect(dragSet(A, new Set([C, B]), shown)).toEqual([A]);
    expect(dragSet(A, new Set(), shown)).toEqual([A]);
    // 다른 보기에서 고른 것은 보이지 않으므로 빠진다
    expect(dragSet(B, new Set([B, "zzzzzzzzzzzz"]), shown)).toEqual([B]);
  });

  test("이미 그 자리에 있는 것은 옮기지 않는다", () => {
    expect(needsMove([A, B, C], f1.id, [f1, f2])).toEqual([B, C]);
    expect(needsMove([A, B, C], null, [f1, f2])).toEqual([A, B]);
    expect(needsMove([A], f1.id, [f1, f2])).toEqual([]);
    expect(needsMove([C], null, [f1, f2])).toEqual([]);
    expect(needsMove([B, B], f1.id, [f1, f2])).toEqual([B]);
  });

  test("화면에 먼저 반영: 모든 폴더에서 빼고 대상에 넣는다. 입력은 바꾸지 않는다", () => {
    const before = [f1, f2];
    const snapshot = JSON.stringify(before);
    const to2 = moveLocally(before, [A, C], f2.id);
    expect(to2.map((f) => [f.id, f.wildcards])).toEqual([
      [f1.id, []],
      [f2.id, [B, A, C]],
    ]);
    expect(groupByFolder([A, B, C].map(w), to2).folders.map((g) => g.items.map((i) => i.id))).toEqual([[], [A, B, C]]);
    const out = moveLocally(before, [A, B], null);
    expect(out.map((f) => f.wildcards)).toEqual([[], []]);
    expect(JSON.stringify(before)).toBe(snapshot);
    // 안 바뀐 폴더는 같은 객체(되돌리기·렌더링 비교가 싸게)
    expect(moveLocally(before, [B], f2.id)[0]).toBe(f1);
  });

  test("오류 문구", () => {
    expect(folderErrorMessage(new ApiError(404, "E_FOLDER_NOT_FOUND", "x"))).toContain("폴더가 없습니다");
    expect(folderErrorMessage(new ApiError(409, "E_FOLDER_NAME_TAKEN", "x"))).toBe("같은 이름의 폴더가 있습니다.");
    expect(folderErrorMessage(new ApiError(500, "E_X", "boom"))).toBe("boom");
    expect(folderErrorMessage(new Error("net"))).toBe("net");
  });
});
