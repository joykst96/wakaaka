"""받은 묶음 검증 (DESIGN 7절, SPEC 3.3): 형식, 키 모양, 문서마다 해시 재계산."""

import json

from .ids import ID12
from .jcs import content_hash

FORMAT = 1


class BundleError(Exception):
    """사용자에게 보여 줄 메시지"""


def _pairs(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError(f"duplicate key {k!r}")
        if k == "__proto__":
            raise ValueError("__proto__ key")
        out[k] = v
    return out


def _reject(name):
    raise ValueError(f"non-finite number {name}")


def parse(raw):
    """JSON 바이트 → dict. NaN/Infinity, 중복 키, __proto__, 깊은 중첩은 BundleError."""
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject, object_pairs_hook=_pairs)
    except (ValueError, RecursionError) as e:
        raise BundleError(f"묶음을 읽을 수 없음: {e}") from None


def verify(b, wid):
    """wid의 묶음인지, 닫혀 있는지, 문서 해시가 키와 맞는지 확인한다."""
    if not isinstance(b, dict):
        raise BundleError("묶음 형식이 아님")
    fmt = b.get("format")
    if type(fmt) is not int or fmt != FORMAT:
        raise BundleError(f"모르는 묶음 형식(format={fmt!r})이라 전개할 수 없음. 와카아카 노드를 업데이트하세요")
    root, lock, docs = b.get("root"), b.get("lock"), b.get("docs")
    if not (isinstance(root, str) and isinstance(lock, dict) and isinstance(docs, dict)):
        raise BundleError("묶음 모양이 틀림")
    for k, v in lock.items():
        if not (ID12.fullmatch(k) and isinstance(v, str) and ID12.fullmatch(v) and v in docs):
            raise BundleError(f"lock 항목이 틀림: {k[:20]!r}")
    if lock.get(wid) != root or root not in docs:
        raise BundleError("묶음의 루트가 요청한 와일드카드와 다름")
    for h, doc in docs.items():
        if not ID12.fullmatch(h):
            raise BundleError(f"문서 키가 틀림: {h[:20]!r}")
        try:
            got = content_hash(doc)
        except (ValueError, RecursionError) as e:
            raise BundleError(f"문서 {h}를 정규화할 수 없음: {e}") from None
        if got != h:
            raise BundleError(f"문서 해시가 맞지 않음: {h} ≠ {got}")
    return b
