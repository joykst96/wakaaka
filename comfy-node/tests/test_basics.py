"""ID 추출, lock 위젯 값, 설정."""

import json
import os
import tempfile
import unittest

from wakaaka_node import ids, settings


class ExtractId(unittest.TestCase):
    def test_id_and_urls(self):
        cases = {
            "J1fAgtUXp3Rj": "J1fAgtUXp3Rj",
            "  J1fAgtUXp3Rj\n": "J1fAgtUXp3Rj",
            "https://wakaaka.baepoyong.com/w/J1fAgtUXp3Rj": "J1fAgtUXp3Rj",
            "http://192.168.0.10:8490/w/J1fAgtUXp3Rj/": "J1fAgtUXp3Rj",
            "https://wakaaka.baepoyong.com/w/J1fAgtUXp3Rj?v=3#x": "J1fAgtUXp3Rj",
            "http://x/api/w/J1fAgtUXp3Rj/bundle": "J1fAgtUXp3Rj",
            "": None,
            "J1fAgtUXp3R": None,  # 11자
            "J1fAgtUXp3Rjk": None,  # 13자
            "https://x/w/J1fAgtUXp3Rjk": None,
            "https://x/u/J1fAgtUXp3Rj": None,
            "J1fAgtUXp3R!": None,
            None: None,
            12: None,
        }
        for raw, want in cases.items():
            self.assertEqual(ids.extract_id(raw), want, raw)


class LockValue(unittest.TestCase):
    LOCK = {"bbbbbbbbbbbb": "222222222222", "aaaaaaaaaaaa": "111111111111"}

    def test_roundtrip_sorted(self):
        s = ids.dump_lock_value(self.LOCK, 12)
        self.assertEqual(s, '{"lock":{"aaaaaaaaaaaa":"111111111111","bbbbbbbbbbbb":"222222222222"},"v":12}')
        self.assertEqual(ids.parse_lock_value(s), {"lock": self.LOCK, "v": 12})
        self.assertEqual(ids.parse_lock_value(ids.dump_lock_value(self.LOCK, None))["v"], None)

    def test_run_and_error_markers(self):
        self.assertEqual(ids.parse_lock_value(ids.dump_lock_value(self.LOCK, 3, run="abc"))["run"], "abc")
        self.assertEqual(ids.parse_lock_value(json.dumps({"error": "x"})), {"error": "x"})

    def test_bad_values(self):
        for s in ["", "  ", "nope", "[]", '{"lock":[]}', '{"lock":{"a":"b"}}', '{"lock":{"aaaaaaaaaaaa":"../../etc/pas"}}',
                  '{"lock":{"aaaaaaaaaaaa":"111111111111"},"v":NaN}', "[" * 100000, None, 5]:
            self.assertIsNone(ids.parse_lock_value(s), repr(s)[:40])
        # 버전이 이상하면 버전만 버린다
        self.assertIsNone(ids.parse_lock_value('{"lock":{"aaaaaaaaaaaa":"111111111111"},"v":true}')["v"])
        self.assertIsNone(ids.parse_lock_value('{"lock":{"aaaaaaaaaaaa":"111111111111"},"v":0}')["v"])

    def test_lock_query(self):
        self.assertEqual(ids.lock_query(self.LOCK), "aaaaaaaaaaaa:111111111111,bbbbbbbbbbbb:222222222222")


class SettingsTest(unittest.TestCase):
    def test_normalize_url(self):
        good = {
            "https://wakaaka.baepoyong.com": "https://wakaaka.baepoyong.com",
            "https://wakaaka.baepoyong.com/": "https://wakaaka.baepoyong.com",
            " http://192.168.0.10:8490 ": "http://192.168.0.10:8490",
            "http://host/sub/": "http://host/sub",
        }
        for raw, want in good.items():
            self.assertEqual(settings.normalize_url(raw), want)
        for raw in ["file:///C:/Windows/win.ini", "javascript:alert(1)", "ftp://x", "http://", "http://u:p@host", "http://host?x=1",
                    "http://host#f", "http://host:99999", "wakaaka.baepoyong.com", "", None, 3]:
            self.assertIsNone(settings.normalize_url(raw), raw)

    def test_load(self):
        with tempfile.TemporaryDirectory() as d:
            p = settings.settings_path(d)
            s = settings.load(p)  # 파일 없음 → 기본값
            self.assertEqual((s.mode, s.url), (settings.DEFAULT_MODE, settings.DEFAULT_URL))
            os.makedirs(os.path.dirname(p))
            with open(p, "w", encoding="utf-8") as f:
                json.dump({settings.MODE_KEY: "server", settings.URL_KEY: "http://192.168.0.10:8490/"}, f)
            s = settings.load(p)
            self.assertEqual((s.mode, s.url), ("server", "http://192.168.0.10:8490"))
            with open(p, "w", encoding="utf-8") as f:
                json.dump({settings.MODE_KEY: "weird", settings.URL_KEY: "file:///x"}, f)
            s = settings.load(p)
            self.assertEqual((s.mode, s.url), (settings.DEFAULT_MODE, None))
            with open(p, "w", encoding="utf-8") as f:
                f.write("{broken")
            self.assertEqual(settings.load(p).mode, settings.DEFAULT_MODE)


if __name__ == "__main__":
    unittest.main()
