"""내용 해시(SPEC 7절)를 Python으로 따로 계산해 hash.json을 검사한다.

    python hashvec.py            # 검사
    python hashvec.py --update   # 빈 문자열("")인 기대값만 채운다. 손으로 쓴 값은 덮어쓰지 않는다

참조 모델(refmodel.py)과 무관하게 표준 라이브러리만으로 짰다. check.py도 이 파일의 check()를 부른다.
"""

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

_SHORT = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


def _reject_constant(name):
    raise ValueError(f"non-finite number {name}")


def parse_json(text):
    """JSON 원문을 읽는다. NaN/Infinity는 거부한다(Python json은 기본으로 받아들인다)."""
    return json.loads(text, parse_constant=_reject_constant)


def _jcs_string(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if 0xD800 <= o <= 0xDFFF:
            raise ValueError("lone surrogate")
        if ch in _SHORT:
            out.append(_SHORT[ch])
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def jcs(v):
    """RFC 8785 정규화. 문서에 나오는 값(정수, 문자열, 불리언, null, 배열, 객체)만 다룬다."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")) or not v.is_integer():
            raise ValueError(f"not an integer: {v!r}")
        return str(int(v))  # 3.0 → 3, -0.0 → 0
    if isinstance(v, str):
        return _jcs_string(v)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        # UTF-16 코드 단위 순. 빅엔디언 UTF-16 바이트를 사전순으로 비교하면 같다.
        keys = sorted(v, key=lambda k: k.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(_jcs_string(k) + ":" + jcs(v[k]) for k in keys) + "}"
    raise TypeError(f"unsupported value: {type(v)}")


def base62_43(digest):
    n = int.from_bytes(digest, "big")
    digits = []
    while n:
        n, r = divmod(n, 62)
        digits.append(ALPHABET[r])
    return "".join(reversed(digits)).rjust(43, "0")


def content_hash(doc):
    """(정규화 문자열, sha256 16진수, 해시 12자)"""
    text = jcs(doc)
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return text, digest.hex(), base62_43(digest)[:12]


def check(rep, update=False):
    """rep.fail(msg)를 가진 보고 객체에 실패를 쌓는다. update면 빈 기대값을 채워 저장한다."""
    path = os.path.join(ROOT, "hash.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    def expect(group, case, field, got):
        if case[field] == "" and update:
            case[field] = got
        elif case[field] != got:
            rep.fail(f"hash.json {group}/{case['name']} {field}: expected {case[field]!r}, got {got!r}")

    for c in data["base62"]:
        expect("base62", c, "out", base62_43(bytes.fromhex(c["in"])))
    for c in data["jcs"]:
        expect("jcs", c, "out", jcs(parse_json(c["input"])))
    for c in data["hash"]:
        text, hexdigest, h = content_hash(parse_json(c["input"]))
        expect("hash", c, "jcs", text)
        expect("hash", c, "sha256", hexdigest)
        expect("hash", c, "out", h)
    if update:
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    n = sum(len(data[g]) for g in ("base62", "jcs", "hash"))
    print(f"hash: {n} vectors")


class _Report:
    def __init__(self):
        self.fails = 0

    def fail(self, msg):
        self.fails += 1
        print("FAIL " + msg)


if __name__ == "__main__":
    r = _Report()
    check(r, "--update" in sys.argv)
    print("OK" if not r.fails else f"{r.fails} failures")
    sys.exit(1 if r.fails else 0)
