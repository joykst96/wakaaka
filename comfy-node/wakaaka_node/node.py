"""노드 `Wakaaka Wildcard` (DESIGN 8절). ComfyUI에 묶이는 함수(채우기, send_sync)는 __init__.py가 넣어 준다."""

import secrets

from .fill import FillError
from .hook import NODE_TYPE, publish
from .ids import parse_lock_value

SEED_MAX = (1 << 64) - 1
# 이 프로세스에서 훅이 채운 값인지 알아보는 표시. prompt의 lock에만 들어가고 워크플로·화면에는 남지 않는다.
RUN_TOKEN = secrets.token_hex(8)


class WakaakaWildcard:
    fill_node = None  # (wildcard, seed, follow_latest, lock) -> fill.Result
    send = None  # (event, data, sid)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "wildcard": ("STRING", {"default": "", "multiline": False, "tooltip": "와일드카드 ID(12자). 웹 주소를 붙여 넣어도 된다."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": SEED_MAX, "control_after_generate": True}),
                "follow_latest": ("BOOLEAN", {"default": True, "tooltip": "켜면 큐에 넣을 때마다 최신 버전으로 받는다. 끄면 저장된 lock을 그대로 쓴다."}),
            },
            "optional": {
                "text": ("STRING", {"default": "", "multiline": True, "tooltip": "큐에 넣을 때 채워지는 결과(읽기 전용)."}),
                "lock": ("STRING", {"default": "", "multiline": False, "tooltip": "큐에 넣을 때 고정한 버전들."}),
            },
            "hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "wakaaka"
    DESCRIPTION = "와카아카 와일드카드를 ID와 seed로 전개한다. 큐에 넣을 때 결과와 lock이 채워져 이미지에 남는다."

    @classmethod
    def IS_CHANGED(cls, lock="", **_):
        lv = parse_lock_value(lock)
        if lv is not None and lv.get("run") == RUN_TOKEN:
            return ""  # 훅이 채운 값이면 입력(text, lock)이 그대로 캐시 키다
        return float("nan")  # 실행할 때 채우는 경우: 최신이 바뀌었을 수 있으므로 매번 실행

    def run(self, wildcard, seed, follow_latest, text="", lock="", unique_id=None, extra_pnginfo=None):
        lv = parse_lock_value(lock)
        if lv is not None and "error" in lv:
            raise RuntimeError(f"[와카아카] {lv['error']}")
        if lv is not None and lv.get("run") == RUN_TOKEN:
            return (text,)
        # 훅이 채우지 못한 경우(입력이 링크였음): 지금 채우고 PNG 워크플로와 화면에도 반영한다
        try:
            r = type(self).fill_node(wildcard, seed, follow_latest, lock)
        except FillError as e:
            raise RuntimeError(f"[와카아카] {e}") from None
        workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
        publish(unique_id, r, None, workflow, type(self).send, None, RUN_TOKEN)
        return (r.text,)


NODE_CLASS_MAPPINGS = {NODE_TYPE: WakaakaWildcard}
NODE_DISPLAY_NAME_MAPPINGS = {NODE_TYPE: "Wakaaka Wildcard"}
