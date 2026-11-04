"""공통 테스트 세트를 참조 모델로 검사한다.

    python check.py            # 모든 파일 검사 (기대값과 다르면 실패)
    python check.py --update   # primitives.json의 out과 expand/*.json의 runs 결과를 다시 채운다(hash.json은 빈 값만 채운다)

--update는 기대값을 참조 모델 출력으로 덮어쓴다. 바뀐 부분은 git diff로 확인한다.
"""

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import hashvec  # noqa: E402
import refmodel as R  # noqa: E402


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="\n") as f:
        f.write(dumps(data) + "\n")


def dumps(v, ind=0):
    """사람이 읽기 좋은 JSON: 짧은 값은 한 줄, 긴 것만 펼친다."""
    one = json.dumps(v, ensure_ascii=False)
    if len(one) + ind <= 110 or not isinstance(v, (dict, list)) or not v:
        return one
    pad = " " * (ind + 2)
    if isinstance(v, list):
        body = (",\n").join(pad + dumps(x, ind + 2) for x in v)
        return "[\n" + body + "\n" + " " * ind + "]"
    body = (",\n").join(pad + json.dumps(k, ensure_ascii=False) + ": " + dumps(x, ind + 2) for k, x in v.items())
    return "{\n" + body + "\n" + " " * ind + "}"


class Report:
    def __init__(self):
        self.fails = 0

    def fail(self, msg):
        self.fails += 1
        print("FAIL " + msg)


# ---------------------------------------------------------------- syntax.json


def check_syntax(rep):
    cases = load("syntax.json")["cases"]
    for case in cases:
        exp = case["expect"]
        try:
            got = {"ast": R.parse(case["text"], case.get("mode", "stored"))}
        except R.SpecError as e:
            got = {"error": e.code}
        ok = ("ast" in got) if "ok" in exp else (got == exp)
        if not ok:
            rep.fail(f"syntax/{case['name']}: expected {exp}, got {got}")
    print(f"syntax: {len(cases)} cases")


# ---------------------------------------------------------------- primitives.json

hx = lambda v: format(v, "016x")  # noqa: E731


def primitives_out(p):
    out = {}
    out["fnv1a64"] = [hx(R.fnv1a64(c["in"].encode("utf-8"))) for c in p["fnv1a64"]]
    out["mix64"] = [hx(R.mix64(int(c["in"], 16))) for c in p["mix64"]]
    out["splitmix64"] = []
    for c in p["splitmix64"]:
        rng = R.SplitMix64(int(c["seed"]))
        out["splitmix64"].append([hx(rng.next()) for _ in range(8)])
    out["derive"] = [hx(R.derive(int(c["seed"]), c["label"])) for c in p["derive"]]
    out["H"] = [hx(R.H(int(c["seed"]), c["labels"])) for c in p["H"]]
    out["bounded"] = []
    for c in p["bounded"]:
        rng = R.SplitMix64(int(c["seed"]))
        out["bounded"].append([str(rng.bounded(int(n))) for n in c["n"]])
    out["sample"] = []
    for c in p["sample"]:
        out["sample"].append(R.weighted_sample(R.SplitMix64(int(c["seed"])), c["weights"], c["k"]))
    out["cleanup"] = [R.cleanup(c["in"]) for c in p["cleanup"]]
    return out


HAND_WRITTEN = {"cleanup"}  # 기대값을 손으로 쓴 그룹. --update가 덮어쓰지 않는다


def check_primitives(rep, update):
    p = load("primitives.json")
    out = primitives_out(p)
    n = 0
    for group, vals in out.items():
        for case, v in zip(p[group], vals):
            n += 1
            if update and group not in HAND_WRITTEN:
                case["out"] = v
            elif case.get("out") != v:
                rep.fail(f"primitives/{group} {case}: got {v}")
    if update:
        save("primitives.json", p)
    print(f"primitives: {n} vectors")


# ---------------------------------------------------------------- expand/*.json


def run_case(bundle, limits, seed, trace=None):
    try:
        ex = R.Expander(bundle, limits)
        ex.trace = trace
        return {"text": ex.expand(int(seed))}
    except R.SpecError as e:
        return {"error": e.code}


def add_one_weights(text):
    """SPEC 2.2 읽는 순서대로 훑으며, 가중치를 적지 않은 선택지 보기 맨 앞에 1*을 넣는다(성질 5 변형)."""
    out, i, n, depth, alt_start = [], 0, len(text), 0, False
    while i < n:
        if alt_start:
            alt_start = False
            if not R._ALT_WEIGHT.match(text, i):
                out.append("1*")
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "\\" and nxt and (nxt in R._ESC or (depth and nxt == "|")):
            out.append(text[i : i + 2])
            i += 2
        elif c == "$" and nxt == "{":
            j = text.find("}", i + 2)
            j = n - 1 if j < 0 else j
            out.append(text[i : j + 1])
            i = j + 1
        elif c == "{" or (c == "|" and depth):
            depth += c == "{"
            out.append(c)
            alt_start = True
            i += 1
        elif c == "}" and depth:
            depth -= 1
            out.append(c)
            i += 1
        else:
            out.append(c)
            i += 1
    if alt_start:
        out.append("1*")
    return "".join(out)


def variants(bundle):
    """4.3절 성질 검사용 변형 묶음. (이름, 묶음, 결과 비교 방식)"""
    # 성질 3: 모든 문서의 항목 순서를 뒤집는다 → 결과가 같아야 한다
    rev = copy.deepcopy(bundle)
    for d in rev["docs"].values():
        if isinstance(d.get("items"), list):
            d["items"].reverse()
    yield "reversed-items", rev, "text"
    # 성질 1: spread가 아닌 ref 항목을 인라인 참조 텍스트로 바꾼다 → 결과가 같아야 한다
    inl = copy.deepcopy(bundle)
    changed = False
    for d in inl["docs"].values():
        for it in d.get("items", []):
            if isinstance(it, dict) and "ref" in it and not it.get("spread") and len(it["ref"]) == 1:
                (kind, target), = it["ref"].items()
                it["text"] = "${w:%s}" % target
                del it["ref"]
                it.pop("spread", None)
                changed = True
    if changed:
        yield "ref-items-inlined", inl, "text"
    # 성질 5: 가중치를 적지 않은 모든 선택지 보기에 1*을 적는다 → 결과가 같아야 한다
    one = copy.deepcopy(bundle)
    changed = False
    for d in one["docs"].values():
        for it in d.get("items", []):
            if isinstance(it, dict) and isinstance(it.get("text"), str):
                new = add_one_weights(it["text"])
                changed = changed or new != it["text"]
                it["text"] = new
    if changed:
        yield "choice-weights-one", one, "text"
    # 성질 2: 모든 텍스트 끝에 글자를 덧붙인다 → 뽑기 기록이 같아야 한다
    lit = copy.deepcopy(bundle)
    for d in lit["docs"].values():
        for it in d.get("items", []):
            if isinstance(it, dict) and isinstance(it.get("text"), str):
                it["text"] += "§"
    yield "text-edited", lit, "trace"


def check_expand(rep, update):
    files = sorted(f for f in os.listdir(os.path.join(ROOT, "expand")) if f.endswith(".json"))
    nruns = 0
    for fn in files:
        case = load("expand/" + fn)
        limits = case.get("limits")
        for run in case["runs"]:
            nruns += 1
            trace = []
            got = run_case(case["bundle"], limits, run["seed"], trace)
            exp = {k: run[k] for k in ("text", "error") if k in run}
            if update:
                run.pop("text", None)
                run.pop("error", None)
                run.update(got)
            elif got != exp:
                rep.fail(f"expand/{fn} seed={run['seed']}: expected {exp}, got {got}")
            if "error" in got:
                continue
            for vname, vb, how in variants(case["bundle"]):
                vtrace = []
                vgot = run_case(vb, limits, run["seed"], vtrace)
                if how == "text" and vgot != got:
                    rep.fail(f"property {vname} expand/{fn} seed={run['seed']}: {got} vs {vgot}")
                if how == "trace" and vtrace != trace:
                    rep.fail(f"property {vname} expand/{fn} seed={run['seed']}: trace differs")
        if update:
            save("expand/" + fn, case)
    print(f"expand: {len(files)} cases, {nruns} runs")


def main():
    update = "--update" in sys.argv
    rep = Report()
    check_syntax(rep)
    check_primitives(rep, update)
    if os.path.isdir(os.path.join(ROOT, "expand")):
        check_expand(rep, update)
    hashvec.check(rep, update)
    print("OK" if not rep.fails else f"{rep.fails} failures")
    sys.exit(1 if rep.fails else 0)


if __name__ == "__main__":
    main()
