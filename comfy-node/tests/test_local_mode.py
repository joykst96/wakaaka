"""로컬 모드, 묶음 검증, 캐시, 오프라인 폴백 (가짜 서버 + 임시 캐시 폴더)."""

import json
import os
import tempfile
import unittest
from urllib.parse import quote

from wakaaka_node import bundle as B
from wakaaka_node import client, fill, ids, jcs
from wakaaka_node.cache import Cache
from wakaaka_node.expander import expand
from wakaaka_node.settings import Settings

from .fakeserver import FakeServer

ROOT, HAIR, EYES = "RootRootRoot", "HairHairHair", "EyesEyesEyes"


def make_bundle(hair_items=("red hair", "blue hair", "{3*silver|platinum} hair")):
    hair = {"schema": 1, "name": "hair", "items": [{"id": f"h{i}", "text": t} for i, t in enumerate(hair_items)]}
    eyes = {"schema": 1, "items": [{"id": "e1", "text": "green eyes"}, {"id": "e2", "text": "red eyes", "w": 3}]}
    hh, he = jcs.content_hash(hair), jcs.content_hash(eyes)
    root = {"schema": 1, "select": {"count": [2, 2]}, "items": [
        {"id": "a", "text": "1girl, ${w:%s}" % HAIR}, {"id": "b", "ref": {"wildcard": EYES}}, {"id": "c", "text": "{smile|}"}]}
    hr = jcs.content_hash(root)
    return {"format": 1, "root": hr, "lock": {ROOT: hr, HAIR: hh, EYES: he}, "docs": {hr: root, hh: hair, he: eyes}}


def raw(b):
    return jcs.canonicalize(b).encode("utf-8")


def meta(b, version=4):
    return {"id": ROOT, "name": "girl", "owner": "me", "version": version, "hash": b["root"]}


class Base(unittest.TestCase):
    def setUp(self):
        client.forget_failures()
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Cache(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def server(self, b, extra=None):
        routes = {f"/api/w/{ROOT}/meta": (200, meta(b), 0), f"/api/w/{ROOT}/bundle": (200, raw(b), 0)}
        routes.update(extra or {})
        return FakeServer(routes)


class LocalMode(Base):
    def test_follow_latest(self):
        b = make_bundle()
        with self.server(b) as srv:
            s = Settings("local", srv.url)
            for seed in [0, 1, 7, (1 << 64) - 1]:
                r = fill.fill(ROOT, seed, True, "", s, cache=self.cache)
                self.assertEqual((r.text, r.lock, r.version, r.source), (expand(b, seed), b["lock"], 4, "local"))
        self.assertTrue(all(self.cache.has_doc(h) for h in b["docs"]))
        self.assertEqual(self.cache.get_latest(ROOT), {"lock": b["lock"], "v": 4})
        with open(os.path.join(self.tmp.name, "docs", b["root"] + ".json"), encoding="utf-8") as f:
            self.assertEqual(f.read(), jcs.canonicalize(b["docs"][b["root"]]))

    def test_fixed_lock_uses_cache_without_network(self):
        b = make_bundle()
        self.cache.put_bundle(b)
        with self.server(b) as srv:
            r = fill.fill(ROOT, 5, False, ids.dump_lock_value(b["lock"], 2), Settings("local", srv.url), cache=self.cache)
            self.assertEqual(srv.requests, [])
        self.assertEqual((r.text, r.version, r.source), (expand(b, 5), 2, "local"))

    def test_fixed_lock_fetches_bundle_when_not_cached(self):
        b = make_bundle()
        with self.server(b) as srv:
            r = fill.fill(ROOT, 5, False, ids.dump_lock_value(b["lock"], 2), Settings("local", srv.url), cache=self.cache)
            self.assertEqual([q["path"] for q in srv.requests], [f"/api/w/{ROOT}/bundle"])
        self.assertEqual((r.text, r.source), (expand(b, 5), "local"))
        self.assertIsNone(self.cache.get_latest(ROOT))  # 고정 lock은 최신으로 기억하지 않는다

    def test_old_version_falls_back_to_resolve(self):
        old, new = make_bundle(("black hair",)), make_bundle()
        q = quote(ids.lock_query(old["lock"]), safe=":,")
        body = {"text": "from server", "seed": "5", "root": old["root"], "lock": old["lock"]}
        with self.server(new, {f"/api/w/{ROOT}/resolve?seed=5&lock={q}": (200, body, 0)}) as srv:
            r = fill.fill(ROOT, 5, False, ids.dump_lock_value(old["lock"], 1), Settings("local", srv.url), cache=self.cache)
        self.assertEqual((r.text, r.version, r.source), ("from server", 1, "server"))

    def test_bad_bundles(self):
        b = make_bundle()
        tampered = json.loads(json.dumps(b))
        tampered["docs"][b["lock"][HAIR]]["items"][0]["text"] = "evil"
        cases = [
            (raw(tampered), "문서 해시가 맞지 않음"),
            (raw({**b, "format": 2}), "노드를 업데이트"),
            (raw({**b, "root": b["lock"][HAIR]}), "루트가 요청한 와일드카드와 다름"),
            (raw({**b, "lock": {**b["lock"], "../../x/yyyy": b["root"]}}), "lock 항목이 틀림"),
            (b'{"format": 1, "format": 1}', "duplicate key"),
            (b'{"format": NaN}', "non-finite"),
            (b"[" * 50000, "묶음을 읽을 수 없음"),
        ]
        for body, want in cases:
            client.forget_failures()
            with self.server(b, {f"/api/w/{ROOT}/bundle": (200, body, 0)}) as srv:
                with self.assertRaises(fill.FillError) as e:
                    fill.fill(ROOT, 1, True, "", Settings("local", srv.url), cache=self.cache)
                self.assertIn(want, str(e.exception))
        self.assertFalse(self.cache.has_doc(b["lock"][HAIR]))  # 검증에 실패한 묶음은 캐시하지 않는다

    def test_expand_error_message(self):
        b = make_bundle()
        root = b["docs"].pop(b["root"])
        root["items"].append({"id": "z", "text": "${w:MissingMissi}"})
        b["root"] = b["lock"][ROOT] = jcs.content_hash(root)
        b["docs"][b["root"]] = root
        with self.server(b) as srv:
            with self.assertRaises(fill.FillError) as e:
                fill.fill(ROOT, 1, True, "", Settings("local", srv.url), cache=self.cache)
        self.assertIn("전개하지 못함: E_UNRESOLVED (MissingMissi)", str(e.exception))


class Offline(Base):
    def dead_url(self):
        with FakeServer() as srv:
            return srv.url

    def test_follow_latest_uses_last_known_lock(self):
        b = make_bundle()
        with self.server(b) as srv:
            fill.fill(ROOT, 1, True, "", Settings("local", srv.url), cache=self.cache)
        for mode in ("local", "server"):
            client.forget_failures()
            r = fill.fill(ROOT, 9, True, "", Settings(mode, self.dead_url()), cache=self.cache)
            self.assertEqual((r.text, r.lock, r.version, r.source), (expand(b, 9), b["lock"], 4, "cache"), mode)

    def test_fixed_lock_offline(self):
        b = make_bundle()
        self.cache.put_bundle(b)
        r = fill.fill(ROOT, 3, False, ids.dump_lock_value(b["lock"], 7), Settings("server", self.dead_url()), cache=self.cache)
        self.assertEqual((r.text, r.version, r.source), (expand(b, 3), 7, "cache"))

    def test_nothing_cached(self):
        b = make_bundle()
        url = self.dead_url()
        for follow, lock, want in [(True, "", "캐시도 없음"), (False, ids.dump_lock_value(b["lock"], 7), "캐시에 이 버전의 문서가 없음")]:
            client.forget_failures()
            with self.assertRaises(fill.FillError) as e:
                fill.fill(ROOT, 3, follow, lock, Settings("local", url), cache=self.cache)
            self.assertIn(f"와일드카드를 찾을 수 없음: {ROOT}", str(e.exception))
            self.assertIn(want, str(e.exception))


class ServerModePrefetch(Base):
    def test_prefetch_then_offline(self):
        b = make_bundle()
        body = {"text": expand(b, 2), "seed": "2", "root": b["root"], "lock": b["lock"]}
        with self.server(b, {f"/api/w/{ROOT}/resolve?seed=2": (200, body, 0)}) as srv:
            pf = fill.Prefetcher(self.cache, lambda: client.Client(srv.url))
            started = []
            r = fill.fill(ROOT, 2, True, "", Settings("server", srv.url), cache=self.cache, prefetch=lambda w: started.append(pf(w)))
            started[0].join(5)
            self.assertEqual(r.source, "server")
            self.assertTrue(all(self.cache.has_doc(h) for h in b["docs"]))
            # 이미 캐시에 있으면 다시 받지 않는다
            started.clear()
            fill.fill(ROOT, 2, True, "", Settings("server", srv.url), cache=self.cache, prefetch=lambda w: started.append(pf(w)))
            self.assertEqual(started, [])
        client.forget_failures()
        r = fill.fill(ROOT, 2, True, "", Settings("server", srv.url), cache=self.cache)
        self.assertEqual((r.text, r.source), (body["text"], "cache"))


class CacheTest(Base):
    def test_corrupt_and_bad_keys(self):
        b = make_bundle()
        self.cache.put_bundle(b)
        p = os.path.join(self.tmp.name, "docs", b["lock"][HAIR] + ".json")
        with open(p, "w", encoding="utf-8") as f:
            f.write('{"schema":1,"items":[]}')  # 내용이 바뀐 파일
        self.assertIsNone(self.cache.get_doc(b["lock"][HAIR]))
        self.assertIsNone(self.cache.bundle(ROOT, b["lock"]))
        for bad in ["../../evil00", "a/b", "short", "", None]:
            with self.assertRaises(ValueError):
                self.cache.has_doc(bad)
        with self.assertRaises(ValueError):
            self.cache.put_doc(b["lock"][EYES], {"schema": 1, "items": []})  # 해시가 다른 문서
        self.assertIsNone(self.cache.get_latest("Nothing00000"))


if __name__ == "__main__":
    unittest.main()
