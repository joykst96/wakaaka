"""와일드카드 ID와 lock 위젯 값 (DESIGN 7·8절)."""

import json
import re

ID12 = re.compile(r"[0-9A-Za-z]{12}")
_URL_ID = re.compile(r"/w/([0-9A-Za-z]{12})(?![0-9A-Za-z])")


def extract_id(raw):
    """위젯 값에서 와일드카드 ID를 뽑는다. ID 그대로이거나 웹 주소(`…/w/<ID>`)를 받는다. 못 찾으면 None."""
    if not isinstance(raw, str):
        return None
    s = raw.strip(" \t\r\n")
    if ID12.fullmatch(s):
        return s
    m = _URL_ID.search(s)
    return m.group(1) if m else None


def valid_lock(lock):
    return isinstance(lock, dict) and all(
        isinstance(k, str) and ID12.fullmatch(k) and isinstance(v, str) and ID12.fullmatch(v) for k, v in lock.items()
    )


def parse_lock_value(s):
    """lock 위젯 값(JSON 문자열)을 dict로. 비었거나 형식이 틀리면 None.

    {"lock": {ID: 해시}, "v": 버전 번호 또는 null}. prompt 안에서만 훅이 "run"(채운 표시)이나 "error"를 더한다.
    """
    if not isinstance(s, str) or s.strip() == "":
        return None
    try:
        v = json.loads(s, parse_constant=_reject)
    except (ValueError, RecursionError):
        return None
    if not isinstance(v, dict):
        return None
    if "error" in v:
        return {"error": str(v["error"])}
    if not valid_lock(v.get("lock")):
        return None
    ver = v.get("v")
    out = {"lock": v["lock"], "v": ver if isinstance(ver, int) and not isinstance(ver, bool) and ver > 0 else None}
    if isinstance(v.get("run"), str):
        out["run"] = v["run"]
    return out


def dump_lock_value(lock, version, **extra):
    return json.dumps({"lock": dict(sorted(lock.items())), "v": version, **extra}, separators=(",", ":"), ensure_ascii=False)


def lock_query(lock):
    """resolve의 lock 쿼리: ID:해시를 ID 순으로 ,로 잇는다 (DESIGN 7절)."""
    return ",".join(f"{k}:{lock[k]}" for k in sorted(lock))


def _reject(name):
    raise ValueError(f"non-finite number {name}")
