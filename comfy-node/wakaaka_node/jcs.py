"""내용 해시 (SPEC 7절): base62_12(sha256(UTF-8(JCS(문서))))."""

import hashlib

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}


def _string(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if 0xD800 <= o <= 0xDFFF:
            raise ValueError("lone surrogate")
        e = _ESC.get(ch)
        out.append(e if e else ("\\u%04x" % o if o < 0x20 else ch))
    out.append('"')
    return "".join(out)


def canonicalize(v):
    """RFC 8785. 문서에 나오는 값(객체, 배열, 문자열, 정수, 불리언, null)만. 정수가 아닌 수는 거부한다."""
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    t = type(v)
    if t is int:
        return str(v)
    if t is float:
        if not v.is_integer():  # NaN·무한대도 여기서 걸린다
            raise ValueError(f"not an integer: {v!r}")
        return str(int(v))
    if t is str:
        return _string(v)
    if t is list:
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    if t is dict:
        keys = sorted(v, key=lambda k: k.encode("utf-16-be", "surrogatepass"))  # UTF-16 코드 단위 순
        return "{" + ",".join(_string(k) + ":" + canonicalize(v[k]) for k in keys) + "}"
    raise ValueError(f"unsupported value: {t.__name__}")


def base62_43(digest):
    n = int.from_bytes(digest, "big")
    out = []
    while n:
        n, r = divmod(n, 62)
        out.append(ALPHABET[r])
    return "".join(reversed(out)).rjust(43, "0")


def content_hash(doc):
    return base62_43(hashlib.sha256(canonicalize(doc).encode("utf-8")).digest())[:12]
