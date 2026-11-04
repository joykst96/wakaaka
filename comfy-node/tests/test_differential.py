"""노드 전개기와 참조 모델(refmodel.py)을 같은 입력으로 비교한다. 저장소 안에서만 돈다.

공통 테스트 세트가 덮지 않는 조합(spread와 전개 횟수 상한, 깊은 중첩, 큰 가중치)을 무작위 묶음으로 덮는다.
참조 모델은 import할 때 전역 재귀 한도를 바꾸므로 테스트 프로세스에서만 쓴다.
"""

import json
import os
import random
import sys
import unittest

from wakaaka_node import expander as X

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
TOOLS = os.path.join(ROOT, "packages", "core", "conformance", "tools")
FIXTURES = os.path.join(ROOT, "fixtures", "out", "bundles.json")
HAVE = os.path.isfile(os.path.join(TOOLS, "refmodel.py"))


def ref_run(R, bundle, seed, limits=None):
    try:
        return {"text": R.Expander(bundle, limits).expand(seed)}
    except R.SpecError as e:
        return {"error": e.code}
    except RecursionError:
        return {"error": "RecursionError"}


def node_run(bundle, seed, limits=None):
    try:
        return {"text": X.Expander(bundle, limits).expand(seed)}
    except X.ExpandError as e:
        return {"error": e.code}


def b62(rng, n):
    return "".join(rng.choice("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") for _ in range(n))


def random_bundle(rng):
    """순환 없는 무작위 묶음. 문서 i는 i보다 뒤의 문서만 참조한다."""
    n = rng.randint(1, 6)
    wids = [b62(rng, 12) for _ in range(n)]
    hashes = [b62(rng, 12) for _ in range(n)]
    words = ["red", "blue", "1girl", "smile", "\\{x\\}", "a\\|b", "한글", "😀", "", " ", ",", "(tag:1.2)", "2::nai::"]

    def text(i, depth=0):
        parts = []
        for _ in range(rng.randint(0, 4)):
            r = rng.random()
            if r < 0.5 or depth > 3:
                parts.append(rng.choice(words))
            elif r < 0.75 and i + 1 < n:
                parts.append("${w:%s}" % wids[rng.randint(i + 1, n - 1)])
            else:
                alts = []
                k = rng.randint(1, 4)
                for a in range(k):
                    w = "" if rng.random() < 0.5 else f"{rng.choice([0, 1, 2, 3, 1000000])}*"
                    alts.append(w + text(i, depth + 1))
                if all(a.startswith("0*") for a in alts):
                    alts[0] = alts[0][2:]
                parts.append("{" + "|".join(alts) + "}")
        return rng.choice([", ", " ", ""]).join(parts)

    docs, lock = {}, {}
    for i in range(n):
        items = []
        for j in range(rng.randint(0, 6)):
            iid = b62(rng, rng.randint(1, 4)) + str(j)
            if i + 1 < n and rng.random() < 0.3:
                it = {"id": iid, "ref": {"wildcard": wids[rng.randint(i + 1, n - 1)]}}
                if rng.random() < 0.5:
                    it["spread"] = True
                elif rng.random() < 0.5:
                    it["w"] = rng.randint(0, 5)
            else:
                it = {"id": iid, "text": text(i)}
                if rng.random() < 0.5:
                    it["w"] = rng.choice([0, 1, 2, 7, 1000000])
            items.append(it)
        lo = rng.randint(0, 3)
        doc = {"schema": 1, "items": items, "select": {"count": [lo, lo + rng.randint(0, 3)], "sep": rng.choice([", ", " | ", "", " "])}}
        docs[hashes[i]] = doc
        lock[wids[i]] = hashes[i]
    return {"format": 1, "root": hashes[0], "lock": lock, "docs": docs}


@unittest.skipUnless(HAVE, "참조 모델이 없음")
class Differential(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, TOOLS)
        import refmodel

        cls.R = refmodel

    def test_random_bundles(self):
        rng = random.Random(20261103)
        stats = {"text": 0, "error": 0}
        for case in range(1500):
            b = random_bundle(rng)
            limits = rng.choice([None, None, {"maxExpansions": rng.randint(1, 30)}, {"maxDepth": rng.randint(0, 3)}])
            for seed in [0, 1, rng.getrandbits(64), (1 << 64) - 1]:
                want = ref_run(self.R, b, seed, limits)
                self.assertEqual(node_run(b, seed, limits), want, f"case {case} seed {seed}\n{json.dumps(b, ensure_ascii=False)[:2000]}")
                stats[next(iter(want))] += 1
        self.assertGreater(stats["error"], 100)  # 예산·깊이 오류도 실제로 거친다
        self.assertGreater(stats["text"], 3000)

    def test_spread_counts_against_budget(self):
        b = {"format": 1, "root": "rootrootroot", "lock": {"AAAAAAAAAAAA": "rootrootroot", "BBBBBBBBBBBB": "bbbbbbbbbbbb"},
             "docs": {"rootrootroot": {"schema": 1, "items": [{"id": "s", "ref": {"wildcard": "BBBBBBBBBBBB"}, "spread": True}]},
                      "bbbbbbbbbbbb": {"schema": 1, "items": [{"id": "x", "text": "x"}]}}}
        for lim, want in [(1, {"error": "E_BUDGET"}), (2, {"text": "x"})]:
            self.assertEqual(node_run(b, 0, {"maxExpansions": lim}), want)
            self.assertEqual(ref_run(self.R, b, 0, {"maxExpansions": lim}), want)

    @unittest.skipUnless(os.path.isfile(FIXTURES), "fixtures/out/bundles.json이 없음(build-examples.ts로 만든다)")
    def test_fixture_bundles(self):
        with open(FIXTURES, encoding="utf-8") as f:
            bundles = json.load(f)
        n = 0
        for name, b in bundles.items():
            ex = self.R.Expander(b)
            mine = X.Expander(b)
            for seed in list(range(300)) + [(1 << 53) + 1, (1 << 64) - 1]:
                self.assertEqual(mine.expand(seed), ex.expand(seed), (name, seed))
                n += 1
        self.assertGreaterEqual(n, 1200)


if __name__ == "__main__":
    unittest.main()
