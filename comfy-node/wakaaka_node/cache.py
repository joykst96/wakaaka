"""해시 단위 캐시 (DESIGN 8절). ComfyUI `user/__wakaaka/cache` 아래에 둬서 노드를 업데이트해도 남는다.

- `docs/<해시>.json`: 해시를 확인한 문서의 정규화 JSON. 읽을 때도 해시를 다시 확인한다.
- `latest/<와일드카드 ID>.json`: 마지막으로 받은 최신 lock과 버전 번호. 오프라인에서 follow_latest가 켜져 있을 때 쓴다.
파일 이름은 base62 12자 정규식을 통과한 값만 쓴다(경로 조작 방지, DESIGN 9절 8항).
"""

import json
import os
import tempfile
import threading

from .ids import ID12, valid_lock
from .jcs import canonicalize, content_hash

_write_lock = threading.Lock()


class Cache:
    def __init__(self, root):
        self.root = root

    def _path(self, kind, key):
        if not isinstance(key, str) or not ID12.fullmatch(key):
            raise ValueError(f"bad cache key {key!r}")
        return os.path.join(self.root, kind, key + ".json")

    def _write(self, path, text):
        d = os.path.dirname(path)
        os.makedirs(d, exist_ok=True)
        with _write_lock:
            fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
                os.replace(tmp, path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise

    def _read(self, path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.loads(f.read(), parse_constant=_reject)
        except (OSError, ValueError, RecursionError):
            return None

    # ------------------------------------------------------------ 문서

    def has_doc(self, h):
        return os.path.isfile(self._path("docs", h))

    def put_doc(self, h, doc):
        """해시가 맞는 문서만 넣는다."""
        if content_hash(doc) != h:
            raise ValueError(f"hash mismatch for {h}")
        if not self.has_doc(h):
            self._write(self._path("docs", h), canonicalize(doc))

    def get_doc(self, h):
        doc = self._read(self._path("docs", h))
        if doc is None:
            return None
        try:
            ok = content_hash(doc) == h
        except (ValueError, RecursionError):
            ok = False
        return doc if ok else None  # 깨졌거나 바뀐 파일은 없는 것으로 본다

    def put_bundle(self, b):
        for h, doc in b["docs"].items():
            self.put_doc(h, doc)

    def bundle(self, wid, lock):
        """lock의 문서가 모두 있으면 묶음을 만든다. 하나라도 없으면 None."""
        if not valid_lock(lock) or wid not in lock:
            return None
        docs = {}
        for h in set(lock.values()):
            doc = self.get_doc(h)
            if doc is None:
                return None
            docs[h] = doc
        return {"format": 1, "root": lock[wid], "lock": dict(lock), "docs": docs}

    # ------------------------------------------------------------ 최신 lock

    def put_latest(self, wid, lock, version):
        self._write(self._path("latest", wid), json.dumps({"lock": dict(sorted(lock.items())), "v": version}, separators=(",", ":")))

    def get_latest(self, wid):
        v = self._read(self._path("latest", wid))
        if not isinstance(v, dict) or not valid_lock(v.get("lock")) or v["lock"].get(wid) is None:
            return None
        ver = v.get("v")
        return {"lock": v["lock"], "v": ver if isinstance(ver, int) and not isinstance(ver, bool) else None}


def _reject(name):
    raise ValueError(f"non-finite number {name}")
