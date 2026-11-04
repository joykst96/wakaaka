"""ComfyUI 설정에서 모드와 서버 주소를 읽는다 (DESIGN 8절 "설정").

프론트가 `user/<사용자>/comfy.settings.json`에 저장하고, 기본값은 바꾸기 전까지 파일에 없다.
그래서 기본값은 web/wakaaka.js의 defaultValue와 같게 여기에도 둔다.
"""

import json
import os
from urllib.parse import urlsplit

MODE_KEY = "Wakaaka.Mode"
URL_KEY = "Wakaaka.ServerUrl"
MODES = ("local", "server")
DEFAULT_MODE = "server"
DEFAULT_URL = "https://wakaaka.baepoyong.com"


class Settings:
    def __init__(self, mode=DEFAULT_MODE, url=DEFAULT_URL):
        self.mode = mode if mode in MODES else DEFAULT_MODE
        self.raw_url = url
        self.url = normalize_url(url)  # None이면 설정이 틀렸다

    def __repr__(self):
        return f"Settings(mode={self.mode!r}, url={self.url!r})"


def normalize_url(s):
    """http(s) 주소만 받는다. 끝의 /를 떼고, 쿼리·조각·사용자 정보가 있으면 None.

    urllib은 file:// 등도 열 수 있으므로 여기서 막는다.
    """
    if not isinstance(s, str):
        return None
    s = s.strip()
    try:
        p = urlsplit(s)
        p.port  # noqa: B018 - 잘못된 포트면 ValueError
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.query or p.fragment:
        return None
    return s.rstrip("/")


def load(settings_path):
    """설정 파일을 읽는다. 없거나 깨졌으면 기본값."""
    data = {}
    try:
        with open(settings_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError, RecursionError):
        pass
    if not isinstance(data, dict):
        data = {}
    return Settings(data.get(MODE_KEY, DEFAULT_MODE), data.get(URL_KEY, DEFAULT_URL))


def settings_path(user_dir, user="default"):
    return os.path.join(user_dir, user, "comfy.settings.json")
