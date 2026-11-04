"""공통 테스트 세트(packages/core/conformance)를 노드 전개기로 돌린다. TS와 같은 파일, 같은 기대값.

저장소 밖(노드만 설치한 곳)에서는 세트가 없으므로 건너뛴다.
"""

import copy
import json
import os
import unittest

from wakaaka_node import expander as X
from wakaaka_node import jcs

CONF = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "core", "conformance")
HAVE = os.path.isdir(CONF)


def load(name):
    with open(os.path.join(CONF, name), encoding="utf-8") as f:
        return json.load(f, parse_constant=lambda n: (_ for _ in ()).throw(ValueError(n)))


def run(bundle, limits, seed):
    try:
        return {"text": X.Expander(bundle, limits).expand(seed)}
    except X.ExpandError as e:
        return {"error": e.code}


def expand_cases():
    d = os.path.join(CONF, "expand")
    return [(f, load("expand/" + f)) for f in sorted(os.listdir(d)) if f.endswith(".json")]


@unittest.skipUnless(HAVE, "공통 테스트 세트가 없음")
class Syntax(unittest.TestCase):
    def test_cases(self):
        cases = load("syntax.json")["cases"]
        for c in cases:
            with self.subTest(c["name"]):
                try:
                    got = {"ast": X.to_common(X.parse(c["text"], c.get("mode", "stored")))}
                except X.ExpandError as e:
                    got = {"error": e.code}
                if "ok" in c["expect"]:
                    self.assertIn("ast", got)
                else:
                    self.assertEqual(got, c["expect"])
        self.assertGreaterEqual(len(cases), 83)

    def test_numbering_is_preorder(self):
        nodes = X.parse("${w:AAAAAAAAAAAA}{a|{b|${w:BBBBBBBBBBBB}}|c}x${w:CCCCCCCCCCCC}")
        got = []
        todo = [nodes]
        while todo:  # 위치 순서와 무관하게 번호만 모은다
            for n in todo.pop():
                if not isinstance(n, str):
                    got.append(n.pos)
                    if isinstance(n, X.Choice):
                        todo.extend(n.alts)
        self.assertEqual(sorted(got), [0, 1, 2, 3, 4])
        self.assertEqual([n.pos for n in nodes if not isinstance(n, str)], [0, 1, 4])
        self.assertEqual(X.refs_in(nodes[1].alts[1])[0].pos, 3)  # {b|${w:B}} 안의 참조

    def test_huge_weight_digits(self):
        for t in ["{" + "1" * 5000 + "*a}", "{" + "0" * 5000 + "1*a}"]:
            if t.startswith("{0"):
                self.assertEqual(X.to_common(X.parse(t)), [{"choice": [["a"]], "w": [1]}])
            else:
                with self.assertRaises(X.ExpandError) as e:
                    X.parse(t)
                self.assertEqual(e.exception.code, "E_CHOICE_WEIGHT")


@unittest.skipUnless(HAVE, "공통 테스트 세트가 없음")
class Primitives(unittest.TestCase):
    def test_vectors(self):
        p = load("primitives.json")
        hx = lambda v: format(v, "016x")  # noqa: E731
        n = 0
        for c in p["fnv1a64"]:
            self.assertEqual(hx(X.fnv1a64(c["in"].encode("utf-8"))), c["out"]); n += 1
        for c in p["mix64"]:
            self.assertEqual(hx(X.mix64(int(c["in"], 16))), c["out"]); n += 1
        for c in p["splitmix64"]:
            rng = X.SplitMix64(int(c["seed"]))
            self.assertEqual([hx(rng.next()) for _ in range(8)], c["out"]); n += 1
        for c in p["derive"]:
            self.assertEqual(hx(X.derive(int(c["seed"]), c["label"])), c["out"]); n += 1
        for c in p["H"]:
            s = int(c["seed"])
            for label in c["labels"]:
                s = X.derive(s, label)
            self.assertEqual(hx(s), c["out"]); n += 1
        for c in p["bounded"]:
            rng = X.SplitMix64(int(c["seed"]))
            self.assertEqual([str(rng.bounded(int(m))) for m in c["n"]], c["out"]); n += 1
        for c in p["sample"]:
            self.assertEqual(X.sample(X.SplitMix64(int(c["seed"])), c["weights"], c["k"]), c["out"]); n += 1
        for c in p["cleanup"]:
            self.assertEqual(X.cleanup(c["in"]), c["out"]); n += 1
        self.assertGreaterEqual(n, 56)


# SPEC 4.3 성질 검사용 변형


def reversed_items(b):
    b = copy.deepcopy(b)
    for d in b["docs"].values():
        if isinstance(d, dict) and isinstance(d.get("items"), list):
            d["items"].reverse()
    return b


def inlined_refs(b):
    b = copy.deepcopy(b)
    for d in b["docs"].values():
        for it in d.get("items", []) if isinstance(d, dict) else []:
            if isinstance(it, dict) and isinstance(it.get("ref"), dict) and not it.get("spread") and list(it["ref"]) == ["wildcard"]:
                it["text"] = "${w:%s}" % it.pop("ref")["wildcard"]
                it.pop("spread", None)
    return b


def one_weights(b):
    """가중치를 안 적은 선택지 보기 맨 앞에 1*을 넣는다(파서 결과를 그대로 다시 쓰지 않고 글자로 넣음)"""
    b = copy.deepcopy(b)

    def add(text):
        out, i, n, depth, start = [], 0, len(text), 0, False
        while i < n:
            if start:
                start = False
                j = i
                while j < n and text[j] in "0123456789.":
                    j += 1
                if not (j > i and j < n and text[j] == "*"):
                    out.append("1*")
            c, nxt = text[i], text[i + 1] if i + 1 < n else ""
            if c == "\\" and nxt and (nxt in "{}$\\" or (depth and nxt == "|")):
                out.append(text[i : i + 2]); i += 2
            elif c == "$" and nxt == "{":
                j = text.find("}", i + 2)
                j = n - 1 if j < 0 else j
                out.append(text[i : j + 1]); i = j + 1
            elif c == "{" or (c == "|" and depth):
                depth += c == "{"; out.append(c); start = True; i += 1
            elif c == "}" and depth:
                depth -= 1; out.append(c); i += 1
            else:
                out.append(c); i += 1
        if start:
            out.append("1*")
        return "".join(out)

    for d in b["docs"].values():
        for it in d.get("items", []) if isinstance(d, dict) else []:
            if isinstance(it, dict) and isinstance(it.get("text"), str):
                it["text"] = add(it["text"])
    return b


def traced(bundle, limits, seed):
    """뽑기(문서 뽑기와 선택지)마다 (가중치, k, 뽑힌 것)을 기록한다"""
    log, orig = [], X.sample

    def rec(rng, weights, k):
        picks = orig(rng, weights, k)
        log.append((tuple(weights), k, tuple(picks)))
        return picks

    X.sample = rec
    try:
        run(bundle, limits, seed)
    finally:
        X.sample = orig
    return log


def marked_texts(b):
    """모든 텍스트 끝에 §를 붙인다. 뽑기가 텍스트를 보지 않으면 뽑기 기록이 같다(성질 2)"""
    b = copy.deepcopy(b)
    for d in b["docs"].values():
        for it in d.get("items", []) if isinstance(d, dict) else []:
            if isinstance(it, dict) and isinstance(it.get("text"), str):
                it["text"] += "§"
    return b


@unittest.skipUnless(HAVE, "공통 테스트 세트가 없음")
class Expand(unittest.TestCase):
    def test_cases(self):
        runs = 0
        for fn, case in expand_cases():
            for r in case["runs"]:
                with self.subTest(f"{fn} seed={r['seed']}"):
                    exp = {k: r[k] for k in ("text", "error") if k in r}
                    self.assertEqual(run(case["bundle"], case.get("limits"), int(r["seed"])), exp)
                runs += 1
        self.assertGreaterEqual(runs, 235)

    def test_properties(self):
        n = 0
        for fn, case in expand_cases():
            lim = case.get("limits")
            variants = [reversed_items(case["bundle"]), inlined_refs(case["bundle"]), one_weights(case["bundle"])]
            marked = marked_texts(case["bundle"])
            for r in case["runs"]:
                if "text" not in r:
                    continue
                seed = int(r["seed"])
                for i, vb in enumerate(variants):
                    self.assertEqual(run(vb, lim, seed), {"text": r["text"]}, f"{fn} seed={seed} variant {i}")
                self.assertEqual(traced(marked, lim, seed), traced(case["bundle"], lim, seed), f"{fn} seed={seed} marked")
                n += 1
        self.assertGreater(n, 150)

    def test_worst_case_depth_without_recursion_limit_change(self):
        import sys

        limit = sys.getrecursionlimit()
        ids = ["c%011d" % i for i in range(17)]
        docs, lock = {}, {}
        for i, wid in enumerate(ids):
            inner = "x" if i == 16 else "${w:%s}" % ids[i + 1]
            docs["h%011d" % i] = {"schema": 1, "items": [{"id": "a", "text": "{" * 64 + inner + "}" * 64}]}
            lock[wid] = "h%011d" % i
        self.assertEqual(X.expand({"format": 1, "root": "h%011d" % 0, "lock": lock, "docs": docs}, 1), "x")
        self.assertEqual(sys.getrecursionlimit(), limit)


@unittest.skipUnless(HAVE, "공통 테스트 세트가 없음")
class Hash(unittest.TestCase):
    def test_vectors(self):
        h = load("hash.json")
        parse = lambda s: json.loads(s, parse_constant=lambda n: (_ for _ in ()).throw(ValueError(n)))  # noqa: E731
        for c in h["base62"]:
            self.assertEqual(jcs.base62_43(bytes.fromhex(c["in"])), c["out"], c["name"])
        for c in h["jcs"]:
            self.assertEqual(jcs.canonicalize(parse(c["input"])), c["out"], c["name"])
        for c in h["hash"]:
            doc = parse(c["input"])
            self.assertEqual(jcs.canonicalize(doc), c["jcs"], c["name"])
            self.assertEqual(jcs.content_hash(doc), c["out"], c["name"])
        self.assertEqual(len(h["base62"]) + len(h["jcs"]) + len(h["hash"]), 19)


if __name__ == "__main__":
    unittest.main()
