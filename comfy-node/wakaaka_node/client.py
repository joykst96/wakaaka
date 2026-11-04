"""와카아카 서버 API 호출 (`/api/w/{id}/meta`, `/resolve`, `/bundle`).

- User-Agent는 `wakaaka-comfy-node/<버전>`. 기본값 `Python-urllib/…`은 Cloudflare가 1010으로 막는다(NOTES Phase 2).
- 훅은 ComfyUI 이벤트 루프 안에서 동기로 돌므로 타임아웃을 짧게 두고, 연결에 실패하면 잠시 그 서버를 부르지 않는다.
- JSON은 NaN/Infinity를 거부하고 읽는다.
"""

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote

from . import USER_AGENT
from .ids import ID12, lock_query, valid_lock

TIMEOUT = 3.0
BACKOFF = 10.0  # 연결 실패 뒤 이 시간(초) 동안은 바로 캐시로 간다
MAX_BODY = 16 * 1024 * 1024  # 묶음 상한 2MB(DESIGN 4절)보다 넉넉히

_down_until = {}
_down_lock = threading.Lock()


class NetworkError(Exception):
    """서버에 닿지 못함(연결 실패, 타임아웃, 최근 실패로 건너뜀)."""


class ApiError(Exception):
    """서버가 오류로 답함, 또는 응답 모양이 틀림."""

    def __init__(self, status, code, message="", detail=None):
        super().__init__(f"{status} {code} {message}".strip())
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}


def _reject(name):
    raise ValueError(f"non-finite number {name}")


def parse_json(raw):
    """서버 응답을 읽는다. NaN/Infinity, 잘못된 UTF-8, 깊은 중첩은 ValueError."""
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject)
    except (UnicodeDecodeError, RecursionError) as e:
        raise ValueError(str(e)) from e


def forget_failures():
    with _down_lock:
        _down_until.clear()


class Client:
    def __init__(self, base_url, timeout=TIMEOUT):
        self.base = base_url
        self.timeout = timeout

    def _get(self, path):
        with _down_lock:
            if _down_until.get(self.base, 0) > time.monotonic():
                raise NetworkError(f"최근에 {self.base}에 연결하지 못해 건너뜀")
        req = urllib.request.Request(self.base + path, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                body = r.read(MAX_BODY + 1)
                status = r.status
        except urllib.error.HTTPError as e:
            if e.code >= 500:  # 서버나 터널(Cloudflare 502·530 등)이 죽은 경우도 캐시로 간다
                with _down_lock:
                    _down_until[self.base] = time.monotonic() + BACKOFF
                raise NetworkError(f"{self.base}가 {e.code}로 답함") from None
            body = e.read(64 * 1024)
            err = {}
            try:
                err = parse_json(body).get("error", {})
            except (ValueError, AttributeError):
                pass
            if not isinstance(err, dict):
                err = {}
            raise ApiError(e.code, str(err.get("code", "E_HTTP")), str(err.get("message", "")), err) from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
            with _down_lock:
                _down_until[self.base] = time.monotonic() + BACKOFF
            raise NetworkError(f"{self.base}에 연결할 수 없음: {getattr(e, 'reason', e)}") from None
        if status != 200:
            raise ApiError(status, "E_HTTP", "unexpected status")
        if len(body) > MAX_BODY:
            raise ApiError(status, "E_RESPONSE", "response too large")
        return body

    def _json(self, path):
        try:
            return parse_json(self._get(path))
        except ValueError as e:
            raise ApiError(200, "E_RESPONSE", f"bad JSON: {e}") from None

    def meta(self, wid):
        m = self._json(f"/api/w/{wid}/meta")
        ok = (
            isinstance(m, dict)
            and m.get("id") == wid
            and isinstance(m.get("name"), str)
            and isinstance(m.get("owner"), str)
            and isinstance(m.get("version"), int)
            and isinstance(m.get("hash"), str)
            and ID12.fullmatch(m["hash"])
        )
        if not ok:
            raise ApiError(200, "E_RESPONSE", "bad meta response")
        return m

    def resolve(self, wid, seed, lock=None):
        q = f"seed={seed}"
        if lock is not None:
            q += "&lock=" + quote(lock_query(lock), safe=":,")
        r = self._json(f"/api/w/{wid}/resolve?{q}")
        ok = (
            isinstance(r, dict)
            and isinstance(r.get("text"), str)
            and r.get("seed") == str(seed)
            and isinstance(r.get("root"), str)
            and valid_lock(r.get("lock"))
            and r["lock"].get(wid) == r["root"]
        )
        if not ok:
            raise ApiError(200, "E_RESPONSE", "bad resolve response")
        return r

    def bundle_bytes(self, wid):
        """묶음 원문 바이트. 검증은 받는 쪽(bundle.py)이 한다."""
        return self._get(f"/api/w/{wid}/bundle")
