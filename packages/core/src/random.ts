// 난수와 하위 seed (SPEC 6절). 모든 연산은 mod 2^64.

const MASK = (1n << 64n) - 1n;
const TWO64 = 1n << 64n;
const GOLDEN = 0x9e3779b97f4a7c15n;

export function mix64(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return z ^ (z >> 31n);
}

export function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & MASK;
  return h;
}

const utf8 = new TextEncoder();
const labelHash = new Map<string, bigint>();

/** derive(s, label) = mix64(s ⊕ mix64(fnv1a64(UTF-8(label)))) */
export function derive(s: bigint, label: string): bigint {
  let m = labelHash.get(label);
  if (m === undefined) {
    m = mix64(fnv1a64(utf8.encode(label)));
    labelHash.set(label, m);
  }
  return mix64(s ^ m);
}

/** H(seed, [l1, …, ln]): derive를 경로를 따라 접는다. */
export function H(seed: bigint, labels: readonly string[]): bigint {
  let s = seed;
  for (const l of labels) s = derive(s, l);
  return s;
}

export class SplitMix64 {
  private state: bigint;
  constructor(seed: bigint) {
    this.state = seed & MASK;
  }
  next(): bigint {
    this.state = (this.state + GOLDEN) & MASK;
    return mix64(this.state);
  }
}

/** [0, n) 안의 정수. 1 ≤ n ≤ 2^64. n = 1이어도 next()를 한 번 부른다. */
export function bounded(rng: SplitMix64, n: bigint): bigint {
  if (n < 1n || n > TWO64) throw new RangeError(`bounded: n out of range: ${n}`);
  const threshold = (TWO64 - n) % n;
  for (;;) {
    const x = rng.next();
    if (x >= threshold) return x % n;
  }
}

/**
 * 가중치 비복원 추출 (6.4절). weights는 이미 정렬된 후보의 가중치(합 > 0, 0인 후보는 뽑히지 않는다)이고,
 * 뽑힌 순서대로 원래 인덱스를 돌려준다. k가 후보 수보다 크면 후보 수로 자른다.
 */
export function sampleWithoutReplacement(rng: SplitMix64, weights: readonly bigint[], k: number): number[] {
  const left = weights.map((w, i) => ({ w, i }));
  const picks: number[] = [];
  const m = Math.min(k, weights.length);
  for (let n = 0; n < m; n++) {
    let total = 0n;
    for (const c of left) total += c.w;
    let r = bounded(rng, total);
    for (let j = 0; j < left.length; j++) {
      const c = left[j]!;
      if (r < c.w) {
        picks.push(c.i);
        left.splice(j, 1);
        break;
      }
      r -= c.w;
    }
  }
  return picks;
}
