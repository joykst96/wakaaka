// 공통 테스트 세트 파일을 그대로 읽는다 (packages/core/conformance).

import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../conformance/", import.meta.url);

export function loadJson<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as T;
}

export interface ExpandCase {
  file: string;
  name: string;
  about?: string;
  covers?: string[];
  limits?: { maxDepth?: number; maxExpansions?: number };
  bundle: any;
  runs: Array<{ seed: string; text?: string; error?: string }>;
}

export function loadExpandCases(): ExpandCase[] {
  const dir = new URL("expand/", DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Omit<ExpandCase, "file">) }));
}
