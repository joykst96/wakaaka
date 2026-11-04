"""테스트용 가짜 와카아카 서버 (http.server, 127.0.0.1 임의 포트)."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeServer:
    """routes: 경로(쿼리 포함) → (상태, 본문 bytes 또는 dict, 지연 초). 받은 요청은 self.requests에 쌓인다."""

    def __init__(self, routes=None):
        self.routes = dict(routes or {})
        self.requests = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fake.requests.append({"path": self.path, "ua": self.headers.get("User-Agent")})
                status, body, delay = fake.routes.get(self.path, (404, {"error": {"code": "E_NOT_FOUND", "message": "not found"}}, 0))
                if delay:
                    time.sleep(delay)
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                except (ConnectionError, OSError):
                    pass

            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
