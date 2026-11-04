"""큐에 넣을 때 노드 하나를 채운다: 와일드카드 ID, seed, lock → 전개 결과와 새 lock (DESIGN 8절 "동작").

- follow_latest가 켜져 있으면 최신으로, 꺼져 있으면 저장된 lock으로 전개한다.
  저장된 lock이 지금 ID의 것이 아니면(ID를 바꿨거나 아직 채운 적이 없음) 최신으로 받는다.
- 서버 모드는 `/resolve`를 부른다. 성공하면 그 버전의 묶음을 백그라운드로 받아 캐시한다(Prefetcher).
- 로컬 모드는 `/bundle`을 받아 해시를 확인하고 캐시한 뒤 Python 전개기로 전개한다.
  고정 lock의 문서가 모두 캐시에 있으면 서버를 부르지 않는다. 옛 버전이라 묶음으로 받을 수 없으면 `/resolve`로 받는다.
- 서버에 닿지 않으면 두 모드 모두 캐시(고정 lock, 없으면 마지막으로 받은 최신 lock)로 전개한다.
- 버전 번호(lock 표시 "v12에 고정")는 `/meta`로 얻는다.
"""

import logging
import threading

from . import bundle as B
from .client import ApiError, Client, NetworkError
from .expander import ExpandError, Expander
from .ids import extract_id, parse_lock_value

SEED_MAX = (1 << 64) - 1
log = logging.getLogger("wakaaka")


class FillError(Exception):
    """노드에 그대로 보여 줄 오류. 메시지는 사용자용이다."""


class Result:
    def __init__(self, wid, text, lock, version, source):
        self.wid = wid
        self.text = text
        self.lock = lock
        self.version = version
        self.source = source  # "server" | "local" | "cache"(서버에 닿지 않아 캐시로 전개)

    def __repr__(self):
        return f"Result({self.wid}, v{self.version}, {self.source}, {self.text!r})"


def not_found(wid, why=""):
    return FillError(f"와일드카드를 찾을 수 없음: {wid}" + (f" ({why})" if why else ""))


def fill(wildcard, seed, follow_latest, lock_value, settings, client=None, cache=None, prefetch=None):
    wid = extract_id(wildcard)
    if wid is None:
        raise FillError(f"와일드카드 ID를 읽을 수 없음: {str(wildcard)[:80]!r} (12자 ID나 와일드카드 웹 주소를 넣으세요)")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= SEED_MAX:
        raise FillError(f"seed는 0 ~ 2^64-1 정수여야 함: {seed!r}")
    if settings.url is None:
        raise FillError(f"와카아카 서버 주소 설정이 올바르지 않음: {settings.raw_url!r} (설정 → Wakaaka)")
    client = client or Client(settings.url)
    fixed = None
    if not follow_latest:
        lv = parse_lock_value(lock_value)
        if lv and "lock" in lv and wid in lv["lock"]:
            fixed = lv
    try:
        if settings.mode == "local":
            r = _local(wid, seed, fixed, client, cache)
        else:
            r = _server(wid, seed, fixed, client)
            if cache is not None and prefetch is not None and not all(cache.has_doc(h) for h in set(r.lock.values())):
                prefetch(wid)
    except NetworkError as e:
        return _offline(wid, seed, fixed, cache, e)
    except ApiError as e:
        raise api_error(wid, e) from None
    except B.BundleError as e:
        raise FillError(str(e)) from None
    if cache is not None and fixed is None:
        try:
            cache.put_latest(wid, r.lock, r.version)
        except OSError:
            log.exception("[wakaaka] cache write failed")
    return r


def _server(wid, seed, fixed, client):
    if fixed is not None:
        r = client.resolve(wid, seed, fixed["lock"])
        return Result(wid, r["text"], r["lock"], fixed["v"], "server")
    m = client.meta(wid)
    r = client.resolve(wid, seed)
    if m["hash"] != r["root"]:  # 그 사이 새 버전이 저장됨
        m = client.meta(wid)
    return Result(wid, r["text"], r["lock"], m["version"] if m["hash"] == r["root"] else None, "server")


def fetch_bundle(client, wid):
    return B.verify(B.parse(client.bundle_bytes(wid)), wid)


def _local(wid, seed, fixed, client, cache):
    if fixed is not None:
        b = cache.bundle(wid, fixed["lock"]) if cache is not None else None
        if b is not None:  # 캐시를 먼저 본다: 서버를 부르지 않는다
            return Result(wid, expand_text(b, seed), fixed["lock"], fixed["v"], "local")
        latest = fetch_bundle(client, wid)
        if cache is not None:
            cache.put_bundle(latest)
        b = cache.bundle(wid, fixed["lock"]) if cache is not None else _from_docs(wid, fixed["lock"], latest["docs"])
        if b is not None:
            return Result(wid, expand_text(b, seed), fixed["lock"], fixed["v"], "local")
        # 옛 버전이라 묶음(최신)으로는 문서를 받을 수 없다: 서버가 전개한다
        r = client.resolve(wid, seed, fixed["lock"])
        return Result(wid, r["text"], r["lock"], fixed["v"], "server")
    m = client.meta(wid)
    b = fetch_bundle(client, wid)
    if m["hash"] != b["root"]:
        m = client.meta(wid)
    if cache is not None:
        cache.put_bundle(b)
    return Result(wid, expand_text(b, seed), b["lock"], m["version"] if m["hash"] == b["root"] else None, "local")


def _from_docs(wid, lock, docs):
    if not all(h in docs for h in lock.values()):
        return None
    return {"format": 1, "root": lock[wid], "lock": dict(lock), "docs": {h: docs[h] for h in set(lock.values())}}


def _offline(wid, seed, fixed, cache, err):
    src = fixed if fixed is not None else (cache.get_latest(wid) if cache is not None else None)
    if src is None:
        raise not_found(wid, f"서버에 연결할 수 없고 캐시도 없음: {err}")
    b = cache.bundle(wid, src["lock"]) if cache is not None else None
    if b is None:
        raise not_found(wid, f"서버에 연결할 수 없고 캐시에 이 버전의 문서가 없음: {err}")
    log.warning("[wakaaka] %s: server unreachable, expanding from cache (%s)", wid, err)
    return Result(wid, expand_text(b, seed), src["lock"], src["v"], "cache")


def expand_text(b, seed):
    try:
        return Expander(b).expand(seed)
    except ExpandError as e:
        raise FillError(f"전개하지 못함: {e.code}" + (f" ({e.wildcard})" if e.wildcard else "")) from None


def api_error(wid, e):
    if e.status == 404:
        other = e.detail.get("wildcard")
        if isinstance(other, str) and other != wid:
            return FillError(f"lock에 있는 하위 와일드카드가 지워졌음: {other} (follow_latest를 켜면 최신으로 받음)")
        return not_found(wid, "지웠거나 없는 ID")
    if e.code in ("E_LOCK", "E_LOCK_INVALID", "E_LOCK_INCOMPLETE"):
        return FillError(f"고정된 lock이 서버의 와일드카드와 맞지 않음: {e.code} (follow_latest를 켜면 최신으로 받음)")
    if e.code == "E_EXPAND":
        ex = e.detail.get("expand") if isinstance(e.detail.get("expand"), dict) else {}
        return FillError(f"전개하지 못함: {ex.get('code', e.code)}" + (f" ({ex['wildcard']})" if ex.get("wildcard") else ""))
    return FillError(f"서버 오류: {e.status} {e.code} {e.message}".strip())


class Prefetcher:
    """서버 모드가 성공한 뒤 그 와일드카드의 묶음을 백그라운드로 받아 캐시한다. 같은 ID는 한 번에 하나만."""

    def __init__(self, cache, client_factory):
        self.cache = cache
        self.client_factory = client_factory
        self._busy = set()
        self._lock = threading.Lock()

    def __call__(self, wid):
        with self._lock:
            if wid in self._busy:
                return None
            self._busy.add(wid)
        t = threading.Thread(target=self._run, args=(wid,), name=f"wakaaka-prefetch-{wid}", daemon=True)
        t.start()
        return t

    def _run(self, wid):
        try:
            self.cache.put_bundle(fetch_bundle(self.client_factory(), wid))
        except (NetworkError, ApiError, B.BundleError, OSError, ValueError) as e:
            log.warning("[wakaaka] prefetch %s failed: %s", wid, e)
        finally:
            with self._lock:
                self._busy.discard(wid)
