# comfy-node — Wakaaka Wildcard

와카아카 와일드카드를 ID와 seed로 전개해 프롬프트 문자열(STRING)을 내는 ComfyUI 커스텀 노드. 설계는 `docs/DESIGN.md` 8절.

표준 라이브러리만 쓴다. 설치할 Python 패키지가 없다.

## 설치

이 `comfy-node` 폴더를 `ComfyUI/custom_nodes/wakaaka`로 복사하고 ComfyUI를 다시 시작한다. 설치할 Python 패키지는 없다.

개발할 때는 복사하지 않고 링크로 연결하면 저장소의 수정이 바로 반영된다(Windows는 junction).

```powershell
New-Item -ItemType Junction -Path <ComfyUI>\custom_nodes\wakaaka -Target <저장소>\comfy-node
```

## 쓰는 법

노드 **Wakaaka Wildcard**(분류 `wakaaka`)를 놓고 출력 `text`를 `CLIPTextEncode`의 text 입력 등에 잇는다. 품질 태그 같은 고정 문구는 와카아카 웹에서 "장면 프리셋" 와일드카드로 만들거나 문자열 연결 노드로 붙인다.

| 위젯 | 내용 |
|---|---|
| `wildcard` | 와일드카드 ID(12자). 웹 주소(`…/w/<ID>`)를 붙여 넣어도 된다. 아래 정보 줄에 "이름 · 소유자 · v번호" |
| `seed` | 표준 seed 위젯(실행 후 고정/증가/무작위) |
| `follow_latest` | 켜짐(기본): 큐에 넣을 때마다 최신 버전으로. 꺼짐: 지난번 lock 그대로(재현) |
| `text` | 읽기 전용. 큐에 넣을 때 전개 결과가 채워진다 |
| `lock` | 숨김. 정보 줄에 "v12에 고정 · 하위 3개"처럼 보인다 |

"웹에서 열기" 버튼은 설정의 서버 주소로 그 와일드카드 페이지를 연다.

큐에 넣을 때 노드가 text와 lock을 채워 실행 입력과 PNG 워크플로에 써 넣는다. 그래서 모든 이미지에 그때의 결과와 lock이 남는다. 옛 이미지를 다시 만들려면 PNG를 불러와 `follow_latest`를 끄고 큐에 넣는다.

`wildcard`나 `seed`를 다른 노드에서 링크로 받으면 큐에 넣을 때 값을 알 수 없어 실행할 때 채운다. 이때도 PNG 워크플로에는 남지만, 화면의 text는 실행이 끝난 뒤에 바뀐다.

## 설정 (ComfyUI 설정 → Wakaaka)

| 설정 | 기본값 | 내용 |
|---|---|---|
| 전개 모드 `Wakaaka.Mode` | 서버 | 서버: 서버가 전개한 결과(`/api/w/{id}/resolve`)를 받는다. 로컬: 묶음(`/bundle`)을 받아 해시를 확인하고 이 PC에서 전개한다. 결과는 같다 |
| 서버 주소 `Wakaaka.ServerUrl` | `https://wakaaka.baepoyong.com` | http(s)만. 직접 띄운 서버를 쓰려면 그 주소로 바꾼다 |

- 큐에 넣을 때의 훅은 누가 넣었는지 모르므로 `default` 사용자의 설정을 쓴다(`--multi-user`에서 사용자마다 다르게 둘 수 없다).
- Windows에서 `localhost`는 IPv6(`::1`)를 먼저 시도해 서버가 IPv4에서만 들으면 요청마다 약 2초 늦다. 로컬 서버는 `http://127.0.0.1:포트`로 적는다.

## 캐시와 오프라인

- 받은 문서는 해시 단위로 `ComfyUI/user/__wakaaka/cache`에 둔다(노드를 업데이트해도 남는다). `docs/<해시>.json`과 마지막 최신 lock `latest/<ID>.json`.
- 서버에 연결할 수 없으면 캐시로 전개한다. `follow_latest`가 켜져 있으면 마지막으로 받은 버전으로, 꺼져 있으면 고정한 lock으로. 정보 줄에 "서버에 연결하지 못해 캐시로 전개함"이 붙는다. 캐시도 없으면 "와일드카드를 찾을 수 없음: ID" 오류가 난다.
- 서버 모드도 성공한 뒤 그 버전의 묶음을 백그라운드로 받아 캐시한다.
- 요청은 User-Agent `wakaaka-comfy-node/<버전>`, 타임아웃 3초. 연결에 실패하면 10초 동안 그 서버를 부르지 않고 바로 캐시로 간다(큐에 넣는 동안 ComfyUI가 멈춰 있기 때문).

## 구조

| 파일 | 내용 |
|---|---|
| `__init__.py` | ComfyUI에 붙이는 곳: on-prompt 훅, `/wakaaka/meta` 경로, 노드 등록, 캐시 위치 |
| `wakaaka_node/node.py` | 노드 정의와 실행 |
| `wakaaka_node/hook.py` | 큐에 넣을 때 prompt·PNG 워크플로·화면에 text와 lock을 쓴다 |
| `wakaaka_node/fill.py` | 모드별로 노드 하나를 채운다(서버, 로컬, 캐시) |
| `wakaaka_node/client.py` | 서버 API 호출 |
| `wakaaka_node/expander.py` | 전개기(`docs/SPEC.md`). TS 전개기와 글자 단위로 같은 결과 |
| `wakaaka_node/jcs.py`, `bundle.py`, `cache.py` | 내용 해시, 묶음 검증, 캐시 |
| `web/wakaaka.js` | 설정, 정보 줄, 읽기 전용 text, "웹에서 열기" |

## 테스트

ComfyUI가 쓰는 Python(포터블이면 `python_embeded/python.exe`)으로 표준 `unittest`만 쓴다.

```bash
python -I -m unittest discover -s comfy-node/tests -t comfy-node
```

- `test_conformance.py`: `packages/core/conformance`의 공통 테스트 세트 전부와 SPEC 4.3 성질(저장소 안에서만)
- `test_differential.py`: 참조 모델(`refmodel.py`)과 무작위 묶음 차등 비교(저장소 안에서만)
- `test_basics.py`, `test_server_mode.py`, `test_local_mode.py`: ID·설정, 가짜 서버로 HTTP·훅·노드·캐시·오프라인
- `test_live.py`: 실제 서버와 curl 응답 비교. `WAKAAKA_LIVE_URL`(예: `http://127.0.0.1:3000`)을 줄 때만 돈다
