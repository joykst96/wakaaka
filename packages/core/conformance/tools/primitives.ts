// primitives.json을 TS로 검사한다. 명세(docs/SPEC.md 6절)를 보고 Python 참조 모델과 따로 짰다.
// Phase 1의 core 구현이 생기면 이 파일 대신 core 테스트가 같은 벡터를 읽는다.
//
//   node packages/core/conformance/tools/primitives.ts
import { readFileSync } from "node:fs";

const M64 = (1n << 64n) - 1n;
const TWO64 = 1n << 64n;

const mix64 = (z: bigint): bigint => {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
};

const utf8 = new TextEncoder();
const fnv1a64 = (s: string): bigint => {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8.encode(s)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & M64;
  return h;
};

const derive = (s: bigint, label: string): bigint => mix64(s ^ mix64(fnv1a64(label)));
const H = (seed: bigint, labels: string[]): bigint => labels.reduce(derive, seed);

class SplitMix64 {
  private state: bigint;
  constructor(seed: bigint) {
    this.state = seed;
  }
  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & M64;
    return mix64(this.state);
  }
  bounded(n: bigint): bigint {
    const threshold = (TWO64 - n) % n;
    for (;;) {
      const x = this.next();
      if (x >= threshold) return x % n;
    }
  }
}

function weightedSample(rng: SplitMix64, weights: number[], k: number): number[] {
  const rest = weights.map((_, i) => i);
  const picks: number[] = [];
  for (let j = 0; j < k && rest.length > 0; j++) {
    let r = rng.bounded(BigInt(rest.reduce((a, i) => a + weights[i], 0)));
    for (let p = 0; p < rest.length; p++) {
      const w = BigInt(weights[rest[p]]);
      if (r < w) {
        picks.push(rest.splice(p, 1)[0]);
        break;
      }
      r -= w;
    }
  }
  return picks;
}

// SPEC 4.4. trim()은 U+00A0 등도 지우므로 공백 네 글자를 직접 지운다.
const BLANK = new Set([" ", "\t", "\n", "\r"]);
function stripBlank(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && BLANK.has(s[a])) a++;
  while (b > a && BLANK.has(s[b - 1])) b--;
  return s.slice(a, b);
}
const cleanup = (s: string): string => stripBlank(s.split(",").filter((p) => stripBlank(p) !== "").join(","));

const hex = (v: bigint) => v.toString(16).padStart(16, "0");
const file = new URL("../primitives.json", import.meta.url);
const p = JSON.parse(readFileSync(file, "utf8"));
let n = 0;
let fails = 0;
const eq = (group: string, c: unknown, got: unknown, want: unknown) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log(`FAIL ${group} ${JSON.stringify(c)}: got ${JSON.stringify(got)}`);
  }
};

for (const c of p.fnv1a64) eq("fnv1a64", c, hex(fnv1a64(c.in)), c.out);
for (const c of p.mix64) eq("mix64", c, hex(mix64(BigInt("0x" + c.in))), c.out);
for (const c of p.splitmix64) {
  const rng = new SplitMix64(BigInt(c.seed));
  eq("splitmix64", c, Array.from({ length: 8 }, () => hex(rng.next())), c.out);
}
for (const c of p.derive) eq("derive", c, hex(derive(BigInt(c.seed), c.label)), c.out);
for (const c of p.H) eq("H", c, hex(H(BigInt(c.seed), c.labels)), c.out);
for (const c of p.bounded) {
  const rng = new SplitMix64(BigInt(c.seed));
  eq("bounded", c, c.n.map((x: string) => rng.bounded(BigInt(x)).toString()), c.out);
}
for (const c of p.sample) eq("sample", c, weightedSample(new SplitMix64(BigInt(c.seed)), c.weights, c.k), c.out);
for (const c of p.cleanup) eq("cleanup", c, cleanup(c.in), c.out);

console.log(`primitives (ts): ${n} vectors, ${fails} failures`);
process.exit(fails ? 1 : 0);
