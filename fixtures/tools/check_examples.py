"""build-examples.ts가 만든 fixtures/out/을 명세 참조 모델로 검사한다.

    python check_examples.py [seed 개수, 기본 5]

- 모든 예시 문서가 스키마(SPEC 3절)와 문법(SPEC 2절)을 통과하는지
- 재료 태그를 이스케이프한 텍스트가 파싱하면 원래 프롬프트 표기 그대로 돌아오는지(선택지 바깥/안)
- 묶음이 전개되는지(결과를 출력한다)
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "out")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "packages", "core", "conformance", "tools"))

import refmodel as R  # noqa: E402


def load(name):
    with open(os.path.join(OUT, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    nseeds = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    sys.stdout.reconfigure(encoding="utf-8")
    fails = 0

    ex = load("examples.json")
    ids = set()
    for w in ex["wildcards"]:
        if w["id"] in ids:
            fails += 1
            print("FAIL 중복 ID", w["name"])
        ids.add(w["id"])
        try:
            doc = R.check_doc(w["doc"])
            for it in doc["items"]:
                if "text" in it:
                    R.parse(it["text"])
        except R.SpecError as e:
            fails += 1
            print(f"FAIL {w['name']}: {e.code}")
    print(f"docs: {len(ex['wildcards'])}")

    rt = load("escape-roundtrip.json")
    for c in rt:
        try:
            ast = R.parse(c["text"])
        except R.SpecError as e:
            ast = e.code
        want = [c["prompt"]] if c["prompt"] else []
        if c["inChoice"]:
            # 선택지 맥락은 보기 하나로 감싸서 확인한다
            try:
                ast = R.parse("{" + c["text"] + "}")
            except R.SpecError as e:
                ast = e.code
            want = [{"choice": [want]}]
        if ast != want:
            fails += 1
            print(f"FAIL roundtrip {c['name']!r} inChoice={c['inChoice']}: {c['text']!r} -> {ast!r}")
    changed = sorted({(c["name"], c["text"]) for c in rt if c["text"] != c["prompt"]})
    print(f"escape roundtrip: {len(rt)} cases, 이스케이프가 붙은 것 {len(changed)}개: " + ", ".join(f"{n} → {t}" for n, t in changed))

    for name, b in load("bundles.json").items():
        try:
            e = R.Expander(b)
            print(f"\n== {name} (문서 {len(b['docs'])}개)")
            for s in range(nseeds):
                print(f"  {s}: {e.expand(s)}")
        except R.SpecError as err:
            fails += 1
            print(f"FAIL bundle {name}: {err.code}")

    print("\nOK" if not fails else f"\n{fails} failures")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
