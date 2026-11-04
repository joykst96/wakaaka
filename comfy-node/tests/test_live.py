"""실제 와카아카 서버와 대조 (환경 변수 WAKAAKA_LIVE_URL이 있을 때만).

    set WAKAAKA_LIVE_URL=http://127.0.0.1:3000
    python -I -m unittest discover -s comfy-node/tests -t comfy-node

같은 요청을 curl로 받은 응답과 노드가 만든 결과를 비교한다.
"""

import json
import os
import subprocess
import unittest
from urllib.parse import quote

from wakaaka_node import USER_AGENT, client, fill, ids
from wakaaka_node.settings import Settings

LIVE = os.environ.get("WAKAAKA_LIVE_URL")
SEEDS = [0, 1, 2, 3, 12345, (1 << 53) + 1, (1 << 64) - 1]


def curl_json(url):
    out = subprocess.run(["curl", "-sS", "-m", "10", "-A", USER_AGENT, url], capture_output=True, check=True).stdout
    return json.loads(out.decode("utf-8"), parse_constant=lambda n: (_ for _ in ()).throw(ValueError(n)))


@unittest.skipUnless(LIVE, "WAKAAKA_LIVE_URL이 없음")
class LiveServerMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        client.forget_failures()
        cls.settings = Settings("server", LIVE)
        cls.ids = [w["id"] for w in curl_json(f"{cls.settings.url}/api/explore?sort=popular")["wildcards"]][:12]

    def test_follow_latest_matches_curl(self):
        self.assertGreater(len(self.ids), 5)
        n = 0
        for wid in self.ids:
            meta = curl_json(f"{self.settings.url}/api/w/{wid}/meta")
            for seed in SEEDS:
                want = curl_json(f"{self.settings.url}/api/w/{wid}/resolve?seed={seed}")
                r = fill.fill(f"{self.settings.url}/w/{wid}", seed, True, "", self.settings)
                self.assertEqual((r.text, r.lock, r.version), (want["text"], want["lock"], meta["version"]), (wid, seed))
                n += 1
        print(f"\n  live follow_latest: {n} resolves = curl")

    def test_fixed_lock_matches_curl(self):
        for wid in self.ids[:5]:
            lock = curl_json(f"{self.settings.url}/api/w/{wid}/resolve?seed=0")["lock"]
            value = ids.dump_lock_value(lock, 1)
            for seed in SEEDS:
                q = quote(ids.lock_query(lock), safe=":,")
                want = curl_json(f"{self.settings.url}/api/w/{wid}/resolve?seed={seed}&lock={q}")
                r = fill.fill(wid, seed, False, value, self.settings)
                self.assertEqual((r.text, r.lock, r.version), (want["text"], want["lock"], 1), (wid, seed))

    def test_not_found(self):
        with self.assertRaisesRegex(fill.FillError, "와일드카드를 찾을 수 없음: zzzzzzzzzzzz"):
            fill.fill("zzzzzzzzzzzz", 0, True, "", self.settings)


if __name__ == "__main__":
    unittest.main()
