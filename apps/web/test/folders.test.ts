// 폴더 묶기, 이름 검사, 접은 폴더 기억, 폴더 정리 경로 (DESIGN 11절 "폴더")

import { describe, expect, test } from "vitest";
import type { Folder } from "../src/lib/api.ts";
import type { KeyValueStore } from "../src/lib/drafts.ts";
import { checkFolderName, folderIndex, groupByFolder, loadCollapsed, saveCollapsed } from "../src/lib/folders.ts";
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
