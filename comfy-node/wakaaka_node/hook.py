"""on-prompt 훅: 큐에 들어온 prompt에서 와카아카 노드를 찾아 text와 lock을 채운다 (DESIGN 8절).

채운 값은 세 곳에 쓴다.
1. `prompt[노드].inputs`: 실행 입력. lock에는 이번 프로세스의 표시(`run`)를 더해, 실행할 때 훅이 채운 값인지 안다.
   채우지 못하면 lock 자리에 `{"error": 메시지}`를 넣어 실행 때 그 오류를 낸다.
2. `extra_data.extra_pnginfo.workflow`: PNG에 저장되는 워크플로의 위젯 값.
3. `send_sync`: 큐에 넣은 브라우저의 위젯.

wildcard·seed·follow_latest·lock 중 하나라도 링크로 들어오면 훅은 값을 모르므로 건너뛰고, 실행할 때 채운다(node.py).
"""

import json
import logging

from .fill import FillError
from .ids import dump_lock_value

NODE_TYPE = "WakaakaWildcard"
EVENT = "wakaaka.fill"
FILL_INPUTS = ("wildcard", "seed", "follow_latest", "lock")

log = logging.getLogger("wakaaka")


def is_link(v):
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int)


def error_value(message):
    return json.dumps({"error": message}, ensure_ascii=False)


def on_prompt(json_data, fill_node, send, run_token):
    """fill_node(wildcard, seed, follow_latest, lock) → fill.Result, send(event, data, sid)."""
    if not isinstance(json_data, dict) or not isinstance(json_data.get("prompt"), dict):
        return json_data
    sid = json_data.get("client_id") or None
    workflow = _get(json_data, "extra_data", "extra_pnginfo", "workflow")
    for nid, node in json_data["prompt"].items():
        if not isinstance(node, dict) or node.get("class_type") != NODE_TYPE or not isinstance(node.get("inputs"), dict):
            continue
        inputs = node["inputs"]
        if any(is_link(inputs.get(k)) for k in FILL_INPUTS):
            continue
        try:
            r = fill_node(inputs.get("wildcard"), inputs.get("seed"), inputs.get("follow_latest") is not False, inputs.get("lock", ""))
        except FillError as e:
            inputs["lock"] = error_value(str(e))
            continue
        except Exception as e:  # 훅의 예외는 ComfyUI가 삼키므로 여기서 노드 오류로 바꾼다
            log.exception("[wakaaka] fill failed for node %s", nid)
            inputs["lock"] = error_value(f"내부 오류: {type(e).__name__}: {e}")
            continue
        publish(nid, r, inputs, workflow, send, sid, run_token)
    return json_data


def publish(nid, r, inputs, workflow, send, sid, run_token):
    value = dump_lock_value(r.lock, r.version)
    if inputs is not None:
        inputs["text"] = r.text
        inputs["lock"] = dump_lock_value(r.lock, r.version, run=run_token)
    if isinstance(workflow, dict):
        set_widgets(workflow, nid, r.text, value)
    if send is not None:
        send(EVENT, {"node": str(nid), "text": r.text, "lock": value, "source": r.source}, sid)


def find_workflow_node(workflow, exec_id):
    """실행 ID(서브그래프 안이면 `바깥:안`)로 워크플로 JSON의 노드를 찾는다.

    서브그래프 안 노드는 정의(definitions.subgraphs)에 있고 같은 서브그래프의 인스턴스끼리 공유한다.
    """
    subgraphs = {}
    defs = workflow.get("definitions")
    if isinstance(defs, dict) and isinstance(defs.get("subgraphs"), list):
        subgraphs = {sg.get("id"): sg for sg in defs["subgraphs"] if isinstance(sg, dict)}
    graph, node = workflow, None
    parts = str(exec_id).split(":")
    for i, part in enumerate(parts):
        nodes = graph.get("nodes") if isinstance(graph, dict) else None
        if not isinstance(nodes, list):
            return None
        node = next((n for n in nodes if isinstance(n, dict) and str(n.get("id")) == part), None)
        if node is None:
            return None
        if i < len(parts) - 1:
            graph = subgraphs.get(node.get("type"))
    return node if node.get("type") == NODE_TYPE else None


def set_widgets(workflow, exec_id, text, lock_value):
    """위젯 순서는 wildcard, seed, (seed 제어), follow_latest, text, lock. text와 lock이 맨 끝 둘이다.

    프론트 1.57은 목록(`widgets_values`)과 이름별(`widgets_values_named`)을 함께 저장하므로 둘 다 고친다.
    """
    node = find_workflow_node(workflow, exec_id)
    if node is None:
        return False
    done = False
    wv = node.get("widgets_values")
    if isinstance(wv, list) and len(wv) >= 2:
        wv[-2], wv[-1] = text, lock_value
        done = True
    elif isinstance(wv, dict):
        wv["text"], wv["lock"] = text, lock_value
        done = True
    named = node.get("widgets_values_named")
    if isinstance(named, dict):
        named["text"], named["lock"] = text, lock_value
        done = True
    return done


def _get(d, *keys):
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d
