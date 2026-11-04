"""서버 모드: HTTP 클라이언트(가짜 서버), 채우기, 훅, 노드 실행."""

import copy
import json
import time
import unittest
from urllib.parse import quote

from wakaaka_node import USER_AGENT, client, fill, hook, ids, node
from wakaaka_node.settings import Settings

from .fakeserver import FakeServer

WID = "J1fAgtUXp3Rj"
SUB = "1YJ0jbthcf17"
ROOT_H = "obZLIBzcLeNY"
SUB_H = "neWjPgN8jabc"
LOCK = {WID: ROOT_H, SUB: SUB_H}
META = {"id": WID, "name": "girl base", "owner": "sample", "version": 3, "hash": ROOT_H}


def resolve_body(seed, text="1girl, solo", lock=LOCK):
    return {"text": text, "seed": str(seed), "root": lock[WID], "lock": lock}


def lock_q(lock):
    return quote(ids.lock_query(lock), safe=":,")


class ClientTest(unittest.TestCase):
    def setUp(self):
        client.forget_failures()

    def test_user_agent_and_shapes(self):
        routes = {
            f"/api/w/{WID}/meta": (200, META, 0),
            f"/api/w/{WID}/resolve?seed=7": (200, resolve_body(7), 0),
            f"/api/w/{WID}/resolve?seed=7&lock={lock_q(LOCK)}": (200, resolve_body(7, "locked"), 0),
        }
        with FakeServer(routes) as srv:
            c = client.Client(srv.url)
            self.assertEqual(c.meta(WID)["version"], 3)
            self.assertEqual(c.resolve(WID, 7)["text"], "1girl, solo")
            self.assertEqual(c.resolve(WID, 7, LOCK)["text"], "locked")
            self.assertEqual({r["ua"] for r in srv.requests}, {USER_AGENT})
            self.assertTrue(USER_AGENT.startswith("wakaaka-comfy-node/"))

    def test_errors(self):
        routes = {
            f"/api/w/{WID}/meta": (404, {"error": {"code": "E_NOT_FOUND", "message": "wildcard not found"}}, 0),
            f"/api/w/{WID}/resolve?seed=1": (422, {"error": {"code": "E_EXPAND", "expand": {"code": "E_BUDGET"}}}, 0),
            f"/api/w/{WID}/resolve?seed=2": (200, b'{"text": NaN}', 0),
            f"/api/w/{WID}/resolve?seed=3": (200, resolve_body(4), 0),  # seed가 다르게 옴
            f"/api/w/{WID}/resolve?seed=5": (200, {**resolve_body(5), "root": SUB_H}, 0),  # root가 lock과 다름
            f"/api/w/{WID}/resolve?seed=6": (200, b"\xff\xfe", 0),
        }
        with FakeServer(routes) as srv:
            c = client.Client(srv.url)
            with self.assertRaises(client.ApiError) as e:
                c.meta(WID)
            self.assertEqual((e.exception.status, e.exception.code), (404, "E_NOT_FOUND"))
            with self.assertRaises(client.ApiError) as e:
                c.resolve(WID, 1)
            self.assertEqual((e.exception.code, e.exception.detail["expand"]["code"]), ("E_EXPAND", "E_BUDGET"))
            for seed in (2, 3, 5, 6):
                with self.assertRaises(client.ApiError) as e:
                    c.resolve(WID, seed)
                self.assertEqual(e.exception.code, "E_RESPONSE", seed)

    def test_5xx_is_network_and_backoff(self):
        routes = {f"/api/w/{WID}/meta": (502, b"<html>bad gateway</html>", 0)}
        with FakeServer(routes) as srv:
            c = client.Client(srv.url)
            with self.assertRaises(client.NetworkError):
                c.meta(WID)
            n = len(srv.requests)
            with self.assertRaises(client.NetworkError):  # 잠시 그 서버를 부르지 않는다
                c.meta(WID)
            self.assertEqual(len(srv.requests), n)

    def test_timeout(self):
        routes = {f"/api/w/{WID}/meta": (200, META, 2.0)}
        with FakeServer(routes) as srv:
            c = client.Client(srv.url, timeout=0.3)
            t = time.monotonic()
            with self.assertRaises(client.NetworkError):
                c.meta(WID)
            self.assertLess(time.monotonic() - t, 1.5)

    def test_refused(self):
        with FakeServer() as srv:
            url = srv.url
        with self.assertRaises(client.NetworkError):
            client.Client(url).meta(WID)


class FakeClient:
    """meta 응답 목록을 차례로 돌려주고, resolve는 주어진 함수로."""

    def __init__(self, metas=(META,), resolve=None, error=None):
        self.metas = list(metas)
        self.calls = []
        self._resolve = resolve or (lambda wid, seed, lock: resolve_body(seed))
        self.error = error

    def meta(self, wid):
        self.calls.append(("meta", wid))
        if self.error:
            raise self.error
        return self.metas.pop(0) if len(self.metas) > 1 else self.metas[0]

    def resolve(self, wid, seed, lock=None):
        self.calls.append(("resolve", wid, seed, lock))
        if self.error:
            raise self.error
        return self._resolve(wid, seed, lock)


SERVER = Settings("server", "http://example.test")


class FillServerMode(unittest.TestCase):
    def test_follow_latest(self):
        c = FakeClient()
        r = fill.fill(f"https://x/w/{WID}", 42, True, ids.dump_lock_value(LOCK, 1), SERVER, c)
        self.assertEqual((r.text, r.lock, r.version, r.source), ("1girl, solo", LOCK, 3, "server"))
        self.assertEqual(c.calls, [("meta", WID), ("resolve", WID, 42, None)])

    def test_new_version_between_meta_and_resolve(self):
        old = {**META, "version": 2, "hash": "oldoldoldold"}
        c = FakeClient(metas=[old, META])
        self.assertEqual(fill.fill(WID, 1, True, "", SERVER, c).version, 3)
        c = FakeClient(metas=[old, old])
        self.assertIsNone(fill.fill(WID, 1, True, "", SERVER, c).version)

    def test_fixed_lock(self):
        c = FakeClient()
        r = fill.fill(WID, 5, False, ids.dump_lock_value(LOCK, 2), SERVER, c)
        self.assertEqual((r.version, c.calls), (2, [("resolve", WID, 5, LOCK)]))

    def test_fixed_lock_for_other_id_follows_latest(self):
        c = FakeClient()
        r = fill.fill(WID, 5, False, ids.dump_lock_value({SUB: SUB_H}, 9), SERVER, c)
        self.assertEqual((r.version, c.calls[0]), (3, ("meta", WID)))
        c = FakeClient()
        fill.fill(WID, 5, False, "", SERVER, c)
        self.assertEqual(c.calls[0], ("meta", WID))

    def test_input_errors(self):
        for wc, seed, want in [("nope", 1, "ID를 읽을 수 없음"), (WID, -1, "seed"), (WID, 1 << 64, "seed"), (WID, True, "seed")]:
            with self.assertRaises(fill.FillError) as e:
                fill.fill(wc, seed, True, "", SERVER, FakeClient())
            self.assertIn(want, str(e.exception))
        with self.assertRaises(fill.FillError) as e:
            fill.fill(WID, 1, True, "", Settings("server", "file:///etc"), FakeClient())
        self.assertIn("서버 주소", str(e.exception))

    def test_server_errors(self):
        cases = [
            (client.ApiError(404, "E_NOT_FOUND"), f"와일드카드를 찾을 수 없음: {WID}"),
            (client.ApiError(404, "E_NOT_FOUND", detail={"wildcard": SUB}), f"하위 와일드카드가 지워졌음: {SUB}"),
            (client.ApiError(400, "E_LOCK_INCOMPLETE"), "lock이 서버의 와일드카드와 맞지 않음"),
            (client.ApiError(422, "E_EXPAND", detail={"expand": {"code": "E_BUDGET"}}), "전개하지 못함: E_BUDGET"),
            (client.NetworkError("down"), f"와일드카드를 찾을 수 없음: {WID} (서버에 연결할 수 없고 캐시도 없음"),
        ]
        for err, want in cases:
            with self.assertRaises(fill.FillError) as e:
                fill.fill(WID, 1, True, "", SERVER, FakeClient(error=err))
            self.assertIn(want, str(e.exception))


def make_prompt(inputs, wv_len=6, client_id="sock1"):
    return {
        "client_id": client_id,
        "prompt": {
            "3": {"class_type": node.NODE_TYPE if hasattr(node, "NODE_TYPE") else hook.NODE_TYPE, "inputs": inputs},
            "9": {"class_type": "CLIPTextEncode", "inputs": {"text": ["3", 0], "clip": ["4", 1]}},
        },
        "extra_data": {
            "extra_pnginfo": {
                "workflow": {
                    "nodes": [
                        {"id": 3, "type": hook.NODE_TYPE, "widgets_values": [WID, 1, "randomize", True, "", ""][:wv_len],
                         "widgets_values_named": {"wildcard": WID, "seed": 1, "follow_latest": True, "text": "", "lock": ""}},
                        {"id": 9, "type": "CLIPTextEncode", "widgets_values": [""]},
                    ]
                }
            }
        },
    }


class HookTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.calls = []

    def send(self, event, data, sid):
        self.sent.append((event, data, sid))

    def filler(self, result=None, error=None):
        def f(wc, seed, follow, lock):
            self.calls.append((wc, seed, follow, lock))
            if error:
                raise error
            return result or fill.Result(WID, f"text for {seed}", LOCK, 3, "server")

        return f

    def test_fills_prompt_workflow_and_ui(self):
        p = make_prompt({"wildcard": WID, "seed": 77, "follow_latest": True, "text": "old", "lock": ""})
        out = hook.on_prompt(p, self.filler(), self.send, "tok")
        inputs = out["prompt"]["3"]["inputs"]
        self.assertEqual(inputs["text"], "text for 77")
        self.assertEqual(ids.parse_lock_value(inputs["lock"]), {"lock": LOCK, "v": 3, "run": "tok"})
        wf = out["extra_data"]["extra_pnginfo"]["workflow"]["nodes"][0]
        clean = ids.dump_lock_value(LOCK, 3)
        self.assertEqual(wf["widgets_values"], [WID, 1, "randomize", True, "text for 77", clean])
        self.assertEqual((wf["widgets_values_named"]["text"], wf["widgets_values_named"]["lock"]), ("text for 77", clean))
        self.assertNotIn("run", wf["widgets_values"][-1])  # 표시는 prompt에만
        self.assertEqual(self.sent, [(hook.EVENT, {"node": "3", "text": "text for 77", "lock": clean, "source": "server"}, "sock1")])
        self.assertEqual(out["prompt"]["9"]["inputs"]["text"], ["3", 0])  # 다른 노드는 그대로

    def test_follow_latest_missing_means_on(self):
        hook.on_prompt(make_prompt({"wildcard": WID, "seed": 1}), self.filler(), self.send, "tok")
        self.assertEqual(self.calls, [(WID, 1, True, "")])

    def test_links_are_left_for_execution(self):
        for k in ("wildcard", "seed", "follow_latest", "lock"):
            inputs = {"wildcard": WID, "seed": 1, "follow_latest": True, "lock": "", k: ["5", 0]}
            p = make_prompt(inputs)
            before = copy.deepcopy(p)
            hook.on_prompt(p, self.filler(), self.send, "tok")
            self.assertEqual(p, before, k)
        self.assertEqual((self.calls, self.sent), ([], []))

    def test_errors_become_markers(self):
        p = make_prompt({"wildcard": WID, "seed": 1, "follow_latest": True, "text": "keep", "lock": ""})
        hook.on_prompt(p, self.filler(error=fill.FillError("와일드카드를 찾을 수 없음: X")), self.send, "tok")
        self.assertEqual(ids.parse_lock_value(p["prompt"]["3"]["inputs"]["lock"]), {"error": "와일드카드를 찾을 수 없음: X"})
        p = make_prompt({"wildcard": WID, "seed": 1, "follow_latest": True})
        with self.assertLogs("wakaaka", "ERROR"):
            hook.on_prompt(p, self.filler(error=KeyError("boom")), self.send, "tok")
        self.assertIn("내부 오류", ids.parse_lock_value(p["prompt"]["3"]["inputs"]["lock"])["error"])
        self.assertEqual(self.sent, [])

    def test_no_client_id_no_workflow(self):
        p = make_prompt({"wildcard": WID, "seed": 1, "follow_latest": True}, client_id=None)
        del p["extra_data"]
        hook.on_prompt(p, self.filler(), self.send, "tok")
        self.assertIsNone(self.sent[0][2])
        self.assertEqual(p["prompt"]["3"]["inputs"]["text"], "text for 1")
        for junk in [None, [], {"prompt": []}, {"prompt": {"1": None, "2": {"class_type": hook.NODE_TYPE, "inputs": None}}}]:
            self.assertEqual(hook.on_prompt(junk, self.filler(), self.send, "t"), junk)

    def test_subgraph_node(self):
        wf = {
            "nodes": [{"id": 12, "type": "aaaa-subgraph-uuid", "widgets_values": []}],
            "definitions": {"subgraphs": [{"id": "aaaa-subgraph-uuid", "nodes": [
                {"id": 3, "type": hook.NODE_TYPE, "widgets_values": [WID, 1, "fixed", False, "", ""]}]}]},
        }
        self.assertTrue(hook.set_widgets(wf, "12:3", "t", "l"))
        self.assertEqual(wf["definitions"]["subgraphs"][0]["nodes"][0]["widgets_values"][-2:], ["t", "l"])
        self.assertFalse(hook.set_widgets(wf, "12:4", "t", "l"))
        self.assertFalse(hook.set_widgets(wf, "3", "t", "l"))
        self.assertFalse(hook.set_widgets({"nodes": [{"id": 3, "type": "Other", "widgets_values": [1, 2]}]}, "3", "t", "l"))


class NodeRunTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        node.WakaakaWildcard.send = staticmethod(lambda e, d, s: self.sent.append((e, d, s)))
        node.WakaakaWildcard.fill_node = staticmethod(lambda wc, seed, follow, lock: fill.Result(WID, f"late {seed}", LOCK, 3, "server"))

    def test_filled_by_hook(self):
        lock = ids.dump_lock_value(LOCK, 3, run=node.RUN_TOKEN)
        n = node.WakaakaWildcard()
        self.assertEqual(n.run(WID, 1, True, "hooked", lock), ("hooked",))
        self.assertEqual(node.WakaakaWildcard.IS_CHANGED(lock=lock, wildcard=WID), "")
        self.assertEqual(self.sent, [])

    def test_error_marker(self):
        with self.assertRaisesRegex(RuntimeError, "와일드카드를 찾을 수 없음: X"):
            node.WakaakaWildcard().run(WID, 1, True, "", json.dumps({"error": "와일드카드를 찾을 수 없음: X"}))

    def test_filled_at_execution(self):
        old = ids.dump_lock_value(LOCK, 3, run="otherprocess")
        pnginfo = make_prompt({})["extra_data"]["extra_pnginfo"]
        out = node.WakaakaWildcard().run(WID, 9, True, "stale", old, unique_id="3", extra_pnginfo=pnginfo)
        self.assertEqual(out, ("late 9",))
        self.assertEqual(pnginfo["workflow"]["nodes"][0]["widgets_values"][-2], "late 9")
        self.assertEqual(self.sent[0][1]["text"], "late 9")
        self.assertNotEqual(node.WakaakaWildcard.IS_CHANGED(lock=old), node.WakaakaWildcard.IS_CHANGED(lock=old))  # NaN

    def test_fill_error_at_execution(self):
        def boom(*a):
            raise fill.FillError("와일드카드를 찾을 수 없음: Y")

        node.WakaakaWildcard.fill_node = staticmethod(boom)
        with self.assertRaisesRegex(RuntimeError, "찾을 수 없음: Y"):
            node.WakaakaWildcard().run(WID, 1, True, "", "")

    def test_input_types(self):
        t = node.WakaakaWildcard.INPUT_TYPES()
        self.assertEqual(list(t["required"]) + list(t["optional"]), ["wildcard", "seed", "follow_latest", "text", "lock"])
        self.assertEqual(t["required"]["seed"][1]["max"], (1 << 64) - 1)


if __name__ == "__main__":
    unittest.main()
