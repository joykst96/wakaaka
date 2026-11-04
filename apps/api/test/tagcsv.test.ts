// 태그 CSV 읽기 (DB 없음). DESIGN 6절 "태그 가져오기", NOTES Phase 5 "danbooru-tags.csv 형식".

import { describe, expect, it } from "vitest";
import { keywordRows, koText, nameKey, parseCsv, readTagCsv, splitDescription, TagCsvError } from "../src/services/tagcsv.ts";

const rows = (s: string) => [...parseCsv(s)].map((r) => r.fields);

describe("parseCsv", () => {
  it("따옴표, 겹친 따옴표, 쉼표, 따옴표 안 줄바꿈, CRLF·LF, BOM", () => {
    expect(rows('﻿a,b\r\n"x, ""y""",2\n"multi\r\nline",\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "2"],
      ["multi\r\nline", ""],
    ]);
  });
  it("빈 필드와 끝 줄바꿈 없음", () => {
    expect(rows("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });
  it("행 번호는 따옴표 안 줄바꿈을 센다", () => {
    expect([...parseCsv('h\n"a\nb"\nc\n')].map((r) => r.line)).toEqual([1, 2, 4]);
  });
  it("닫히지 않은 따옴표, 따옴표 뒤 글자, 따옴표 없는 칸 안의 따옴표는 오류", () => {
    expect(() => rows('a\n"abc')).toThrow(TagCsvError);
    expect(() => rows('"a"b,c')).toThrow(/text after closing quote/);
    expect(() => rows('a"b,c')).toThrow(/quote inside/);
  });
});

describe("splitDescription", () => {
  it("[대분류 > 소분류] 본문 키워드: a, b", () => {
    expect(splitDescription("[인물 > 인원수] 여성 캐릭터 한 명. 키워드: 1녀, 여캐, 여캐 ,")).toEqual({ body: "여성 캐릭터 한 명.", keywords: ["1녀", "여캐"] });
  });
  it("분류 표시가 아닌 대괄호와 키워드 없는 글은 그대로", () => {
    expect(splitDescription("[World_Witches_Series] text")).toEqual({ body: "[World_Witches_Series] text", keywords: [] });
    expect(splitDescription("English wiki text.")).toEqual({ body: "English wiki text.", keywords: [] });
    expect(splitDescription("")).toEqual({ body: "", keywords: [] });
  });
});

const CSV4 = [
  "name,category,post_count,description",
  'long_hair,0,5589043,"[머리카락 > 머리 길이] 긴 머리카락. 키워드: 긴머리, 장발, 롱헤어"',
  'hatsune_miku,4,131891,"[캐릭터 > 보컬로이드/버추얼] 보컬로이드. 키워드: 하츠네 미쿠, 미쿠"',
  '"don\'t_say_""lazy""",3,500,',
  "sayo_(project_moon),4,99,,",
  "voymastina_(girls'_frontline_2),4,99,An android.,威玛西娜|보이마스티나(소녀전선2)|Voymastina",
  "",
].join("\r\n");

describe("readTagCsv", () => {
  it("지금 CSV 모양: 헤더 4열, 뒤쪽 행의 이름 없는 다섯째 열은 other_names", () => {
    const r = readTagCsv(CSV4);
    expect(r.header).toEqual(["name", "category", "post_count", "description"]);
    expect(r.unknownColumns).toEqual([]);
    expect(r.extraColumnRows).toBe(2);
    expect(r.records.map((x) => x.name)).toEqual(["long_hair", "hatsune_miku", 'don\'t_say_"lazy"', "sayo_(project_moon)", "voymastina_(girls'_frontline_2)"]);
    expect(r.records[0]).toEqual({
      name: "long_hair",
      category: 0,
      postCount: 5589043,
      description: "[머리카락 > 머리 길이] 긴 머리카락. 키워드: 긴머리, 장발, 롱헤어",
      body: "긴 머리카락.",
      keywords: ["긴머리", "장발", "롱헤어"],
      otherNames: [],
      majorCategory: null, // 대괄호 분류는 예전 체계라 분류 열로 쓰지 않는다
      minorCategory: null,
    });
    expect(r.records[3]!.otherNames).toEqual([]);
    expect(r.records[4]!.otherNames).toEqual(["威玛西娜", "보이마스티나(소녀전선2)", "Voymastina"]);
  });

  it("6열 최종본 모양: 분류 열을 쓰고, 열 순서가 달라도 이름으로 읽는다. 모르는 열은 무시하고 보고", () => {
    const r = readTagCsv(
      ["post_count,name,category,description,major_category,minor_category,extra", "10,cat_ears,0,고양이 귀. 키워드: 고양이 귀,M05 신체,동물 부위,x", "3,a,1,,,,"].join("\n"),
    );
    expect(r.unknownColumns).toEqual(["extra"]);
    expect(r.records[0]).toMatchObject({ name: "cat_ears", postCount: 10, majorCategory: "M05 신체", minorCategory: "동물 부위", keywords: ["고양이 귀"] });
    expect(r.records[1]).toMatchObject({ majorCategory: null, minorCategory: null });
  });

  it("keywords·other_names 열이 있으면 그것을 쓰고, 다섯째 열 예외는 쓰지 않는다", () => {
    const r = readTagCsv("name,category,post_count,keywords,other_names\na,0,1,\"x, y\",p|q\n");
    expect(r.records[0]).toMatchObject({ keywords: ["x", "y"], otherNames: ["p", "q"] });
    expect(() => readTagCsv("name,category,post_count,other_names\na,0,1,p,extra\n")).toThrow(/expected 4 fields, got 5/);
  });

  it("필수 열, 열 수, 이름·분류·포스트 수, 중복, 문자열 검사", () => {
    expect(() => readTagCsv("name,post_count\na,1\n")).toThrow(/missing column category/);
    expect(() => readTagCsv("name,name,category,post_count\n")).toThrow(/duplicate column name/);
    expect(() => readTagCsv("name,category,post_count\na,0\n")).toThrow(/line 2: expected 3 fields, got 2/);
    expect(() => readTagCsv("name,category,post_count\na,0,1,x,y\n")).toThrow(/expected 3 fields, got 5/);
    expect(() => readTagCsv("name,category,post_count\n,0,1\n")).toThrow(/bad tag name/);
    expect(() => readTagCsv("name,category,post_count\nlong hair,0,1\n")).toThrow(/bad tag name/);
    expect(() => readTagCsv("name,category,post_count\na,2,1\n")).toThrow(/bad category 2/);
    expect(() => readTagCsv("name,category,post_count\na,0,-1\n")).toThrow(/bad post_count/);
    expect(() => readTagCsv("name,category,post_count\na,0,1.5\n")).toThrow(/bad post_count/);
    expect(() => readTagCsv("name,category,post_count\na,0,99999999999\n")).toThrow(/bad post_count/);
    expect(() => readTagCsv("name,category,post_count\na,0,1\na,0,2\n")).toThrow(/line 3: duplicate tag name a/);
    expect(() => readTagCsv("name,category,post_count,description\na,0,1,x\u0000y\n")).toThrow(/not allowed/);
    expect(() => readTagCsv("name,category,post_count,description\na,0,1,x\u001fy\n")).toThrow(/not allowed/);
    expect(() => readTagCsv("name,category,post_count,description\na,0,1,\ud800\n")).toThrow(/not allowed/);
    expect(() => readTagCsv("")).toThrow(/empty file/);
  });
});

describe("검색 키", () => {
  const [longHair, miku, , , voy] = readTagCsv(CSV4).records;
  it("영문 이름 키는 밑줄·공백을 빼고 소문자", () => {
    expect(nameKey("long_hair")).toBe("longhair");
    expect(nameKey("Long Hair")).toBe("longhair");
  });
  it("키워드 표: 전체(공백 제거, kind 0)와 낱말(kind 1), 한글 other_names", () => {
    expect(keywordRows(longHair!)).toEqual([
      { key: "긴머리", kind: 0 },
      { key: "장발", kind: 0 },
      { key: "롱헤어", kind: 0 },
    ]);
    expect(keywordRows(miku!)).toEqual([
      { key: "하츠네미쿠", kind: 0 },
      { key: "미쿠", kind: 0 }, // 키워드 '미쿠'가 있으므로 낱말 '미쿠'(kind 1)는 더하지 않는다
      { key: "하츠네", kind: 1 },
    ]);
    expect(keywordRows(voy!)).toEqual([{ key: "보이마스티나(소녀전선2)", kind: 0 }]);
  });
  it("부분 일치 글에는 한국어 이름과 한글 본문만 (영어 위키 본문은 빼고)", () => {
    expect(koText(longHair!)).toBe("긴머리\n장발\n롱헤어\n긴 머리카락.");
    expect(koText(voy!)).toBe("보이마스티나(소녀전선2)");
  });
});
