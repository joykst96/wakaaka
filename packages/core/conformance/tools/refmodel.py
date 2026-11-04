"""와카아카 명세 참조 모델 (docs/SPEC.md).

공통 테스트 세트의 기대 출력을 만들고 명세를 리허설하기 위한 코드다. 노드나 서버가 쓰는
본 구현이 아니다. 읽기 쉬운 것을 우선하고 표준 라이브러리만 쓴다.
"""

import re
import sys

sys.setrecursionlimit(20000)  # 참조 16단 × 선택지 64겹을 재귀로 따라간다

# ---------------------------------------------------------------- 2. 인라인 문법

MAX_NESTING = 64
MAX_WEIGHT = 1_000_000
BLANK = " \t\n\r"  # SPEC 1절의 "공백"
_STORED = re.compile(r"(w):([0-9A-Za-z]{12})")
_ESC = "{}$\\"
_ALT_WEIGHT = re.compile(r"[0-9.]+\*")  # SPEC 2.2 규칙 0: 보기 맨 앞의 숫자·점 + *


class SpecError(Exception):
    def __init__(self, code, pos=None):
        super().__init__(code if pos is None else f"{code} at {pos}")
        self.code = code
        self.pos = pos


def _ref_node(body, mode, pos):
    if body.strip(BLANK) == "":
        raise SpecError("E_REF_EMPTY", pos)
    if "=" in body:
        raise SpecError("E_REF_RESERVED", pos)
    if any(c in body for c in "{$\\|"):
        raise SpecError("E_REF_INVALID", pos)
    if body.startswith("h:"):  # 예전 해시 참조. 접두사만 예약
        raise SpecError("E_REF_RESERVED", pos)
    m = _STORED.fullmatch(body)
    if m:
        return {"ref": m.group(1), "id": m.group(2)}
    if ":" in body:
        raise SpecError("E_REF_INVALID", pos)
    if mode == "stored":
        raise SpecError("E_REF_NAME", pos)
    return {"ref": "name", "name": body.strip(BLANK)}


def parse(text, mode="stored"):
    """텍스트를 SPEC 2.4절의 구문 트리(JSON 호환 list)로 바꾼다."""
    root = []
    cur = root
    stack = []  # (choice 노드, 바깥 노드 목록, 여는 괄호 위치)
    buf = []

    def flush():
        if buf:
            s = "".join(buf)
            buf.clear()
            if cur and isinstance(cur[-1], str):
                cur[-1] += s
            else:
                cur.append(s)

    i, n = 0, len(text)
    alt_start = False  # 바로 앞에서 선택지를 열었거나 보기를 나눴다
    while i < n:
        if alt_start:
            alt_start = False
            m = _ALT_WEIGHT.match(text, i)
            if m:
                digits = m.group()[:-1]
                if "." in digits or int(digits) > MAX_WEIGHT:
                    raise SpecError("E_CHOICE_WEIGHT", i)
                node = stack[-1][0]
                node["_w"][-1] = int(digits)
                node["_explicit"] = True
                i = m.end()
                continue
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "\\" and nxt and (nxt in _ESC or (stack and nxt == "|")):
            buf.append(nxt)
            i += 2
        elif c == "$" and nxt == "{":
            j = text.find("}", i + 2)
            if j < 0:
                raise SpecError("E_UNCLOSED_REF", i)
            node = _ref_node(text[i + 2 : j], mode, i)
            flush()
            cur.append(node)
            i = j + 1
        elif c == "{":
            if len(stack) >= MAX_NESTING:
                raise SpecError("E_NESTING", i)
            flush()
            node = {"choice": [[]], "_w": [1], "_explicit": False}
            cur.append(node)
            stack.append((node, cur, i))
            cur = node["choice"][0]
            alt_start = True
            i += 1
        elif c == "|" and stack:
            flush()
            alt = []
            stack[-1][0]["choice"].append(alt)
            stack[-1][0]["_w"].append(1)
            cur = alt
            alt_start = True
            i += 1
        elif c == "}":
            if not stack:
                raise SpecError("E_UNMATCHED_CLOSE", i)
            flush()
            node, cur, start = stack.pop()
            weights = node.pop("_w")
            if sum(weights) == 0:
                raise SpecError("E_CHOICE_WEIGHT", start)
            if node.pop("_explicit"):
                node["w"] = weights  # 하나라도 적었을 때만 (SPEC 2.4)
            i += 1
        else:
            buf.append(c)
            i += 1
    if stack:
        raise SpecError("E_UNCLOSED_CHOICE", stack[-1][2])
    flush()
    return root


def number_nodes(ast):
    """참조·선택지 노드를 전위 순회 순서로 나열한다. 목록의 인덱스가 노드 번호다."""
    out = []

    def walk(nodes):
        for node in nodes:
            if isinstance(node, str):
                continue
            out.append(node)
            if "choice" in node:
                for alt in node["choice"]:
                    walk(alt)

    walk(ast)
    return out


# ---------------------------------------------------------------- 6. 난수와 하위 seed

M64 = (1 << 64) - 1
GAMMA = 0x9E3779B97F4A7C15


def mix64(z):
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
    return z ^ (z >> 31)


def fnv1a64(data):
    h = 0xCBF29CE484222325
    for b in data:
        h = ((h ^ b) * 0x100000001B3) & M64
    return h


def derive(s, label):
    return mix64(s ^ mix64(fnv1a64(label.encode("utf-8"))))


def H(seed, labels):
    for label in labels:
        seed = derive(seed, label)
    return seed


class SplitMix64:
    def __init__(self, seed):
        self.state = seed & M64

    def next(self):
        self.state = (self.state + GAMMA) & M64
        return mix64(self.state)

    def bounded(self, n):
        assert 1 <= n <= 1 << 64
        threshold = ((1 << 64) - n) % n
        while True:
            x = self.next()
            if x >= threshold:
                return x % n


def weighted_sample(rng, weights, k):
    """비복원 가중치 추출. weights는 정렬된 후보의 w(모두 > 0). 뽑힌 인덱스를 뽑힌 순서로 돌려준다."""
    rest = list(range(len(weights)))
    picks = []
    for _ in range(min(k, len(rest))):
        r = rng.bounded(sum(weights[i] for i in rest))
        for pos, i in enumerate(rest):
            if r < weights[i]:
                picks.append(rest.pop(pos))
                break
            r -= weights[i]
    return picks


# ---------------------------------------------------------------- 3. 문서 검사

_B62 = re.compile(r"[0-9A-Za-z]+")
_ID12 = re.compile(r"[0-9A-Za-z]{12}")
DEFAULT_LIMITS = {"maxDepth": 16, "maxExpansions": 10000}


def _int(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SpecError("E_DOC")
    if isinstance(v, float):
        if not v.is_integer():
            raise SpecError("E_DOC")
        v = int(v)
    if not lo <= v <= hi:
        raise SpecError("E_DOC")
    return v


def check_doc(doc):
    """스키마를 검사하고 기본값을 채운 사본을 돌려준다."""
    if not isinstance(doc, dict) or doc.get("schema") != 1:
        raise SpecError("E_DOC")
    sel = doc.get("select", {})
    if not isinstance(sel, dict):
        raise SpecError("E_DOC")
    count = sel.get("count", [1, 1])
    if not isinstance(count, list) or len(count) != 2:
        raise SpecError("E_DOC")
    lo, hi = _int(count[0], 0, 5000), _int(count[1], 0, 5000)
    if lo > hi:
        raise SpecError("E_DOC")
    sep = sel.get("sep", ", ")
    if not isinstance(sep, str):
        raise SpecError("E_DOC")
    items = doc.get("items")
    if not isinstance(items, list) or len(items) > 5000:
        raise SpecError("E_DOC")
    seen, out = set(), []
    for it in items:
        if not isinstance(it, dict):
            raise SpecError("E_DOC")
        iid = it.get("id")
        if not isinstance(iid, str) or not 1 <= len(iid) <= 16 or not _B62.fullmatch(iid) or iid in seen:
            raise SpecError("E_DOC")
        seen.add(iid)
        if ("text" in it) == ("ref" in it):
            raise SpecError("E_DOC")
        spread = it.get("spread", False)
        if not isinstance(spread, bool) or (spread and "ref" not in it) or ("spread" in it and "text" in it):
            raise SpecError("E_DOC")
        if spread and "w" in it:
            raise SpecError("E_DOC")
        w = _int(it.get("w", 1), 0, 1000000)
        entry = {"id": iid, "w": w, "spread": spread}
        if "text" in it:
            if not isinstance(it["text"], str):
                raise SpecError("E_DOC")
            entry["text"] = it["text"]
        else:
            ref = it["ref"]
            if not isinstance(ref, dict) or len(ref) != 1:
                raise SpecError("E_DOC")
            (kind, target), = ref.items()
            if kind != "wildcard" or not isinstance(target, str) or not _ID12.fullmatch(target):
                raise SpecError("E_DOC")
            entry["ref"] = ("w", target)
        out.append(entry)
    return {"count": (lo, hi), "sep": sep, "items": out}


# ---------------------------------------------------------------- 4. 전개


class Expander:
    def __init__(self, bundle, limits=None):
        self.limits = dict(DEFAULT_LIMITS, **(limits or {}))
        # SPEC 4.1 1단계: format과 묶음 모양. True == 1이므로 bool을 따로 막는다.
        if not isinstance(bundle, dict) or isinstance(bundle.get("format"), bool) or bundle.get("format") != 1:
            raise SpecError("E_FORMAT")
        if not isinstance(bundle.get("root"), str) or not isinstance(bundle.get("lock"), dict) or not isinstance(bundle.get("docs"), dict):
            raise SpecError("E_FORMAT")
        self.lock = bundle["lock"]
        self.raw = bundle["docs"]
        self.docs = {}  # 해시 → 검사한 문서
        self.asts = {}  # (해시, 항목 id) → (ast, 번호 매긴 노드)
        self.trace = None  # 목록을 넣으면 뽑기와 선택을 기록한다(성질 검사용)
        self.root = self._resolve(("root", bundle.get("root")))  # 루트만 해시로 직접 찾는다
        self._preflight()

    def _resolve(self, ref):
        kind, key = ref
        h = self.lock.get(key) if kind == "w" else key
        if not isinstance(h, str) or h not in self.raw:
            raise SpecError("E_UNRESOLVED")
        return h

    def _edges(self, h):
        """문서 h가 참조하는 해시 목록(중복 포함, 문서 순서)."""
        out = []
        for it in self.docs[h]["items"]:
            if "ref" in it:
                out.append(self._resolve(it["ref"]))
            else:
                for node in self.asts[(h, it["id"])][1]:
                    if "ref" in node:
                        out.append(self._resolve((node["ref"], node["id"])))
        return out

    def _load(self, h):
        if h in self.docs:
            return
        doc = check_doc(self.raw[h])
        self.docs[h] = doc
        for it in doc["items"]:
            if "text" in it:
                ast = parse(it["text"])
                self.asts[(h, it["id"])] = (ast, number_nodes(ast))

    def _preflight(self):
        # 반복 DFS: 순환 검사와 가장 긴 경로(높이) 계산
        height = {}
        state = {}  # 1 = 방문 중, 2 = 끝남
        stack = [(self.root, None)]
        while stack:
            h, it = stack[-1]
            if it is None:
                self._load(h)
                state[h] = 1
                it = iter(self._edges(h))
                stack[-1] = (h, it)
            nxt = next(it, None)
            if nxt is None:
                height[h] = max((height[t] + 1 for t in self._edges(h)), default=0)
                state[h] = 2
                stack.pop()
            elif state.get(nxt) == 1:
                raise SpecError("E_CYCLE")
            elif state.get(nxt) is None:
                stack.append((nxt, None))
        if height[self.root] > self.limits["maxDepth"]:
            raise SpecError("E_DEPTH")

    def expand(self, seed):
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= M64:
            raise SpecError("E_SEED")
        self.budget = self.limits["maxExpansions"]
        return cleanup(self._doc(self.root, seed))

    def _spend(self):
        self.budget -= 1
        if self.budget < 0:
            raise SpecError("E_BUDGET")

    def _pool(self, h, prefix, out):
        for it in self.docs[h]["items"]:
            key = prefix + [it["id"]]
            if it["spread"]:
                self._spend()
                self._pool(self._resolve(it["ref"]), key, out)
            else:
                out.append((key, h, it))
        return out

    def _doc(self, h, c):
        self._spend()
        doc = self.docs[h]
        entries = self._pool(h, [], [])
        rng = SplitMix64(derive(c, "select"))
        lo, hi = doc["count"]
        k = lo + rng.bounded(hi - lo + 1)
        cands = sorted((e for e in entries if e[2]["w"] > 0), key=lambda e: e[0])
        picks = weighted_sample(rng, [e[2]["w"] for e in cands], k)
        if self.trace is not None:
            self.trace.append(("pick", h, c, [cands[i][0] for i in picks]))
        parts = []
        for i in picks:
            key, src, it = cands[i]
            s = self._item(src, it, H(c, ["item:" + x for x in key]))
            if s != "":
                parts.append(s)
        return doc["sep"].join(parts)

    def _item(self, h, it, t):
        if "ref" in it:
            return self._doc(self._resolve(it["ref"]), derive(t, "pos:0"))
        ast, nodes = self.asts[(h, it["id"])]
        pos = {id(node): p for p, node in enumerate(nodes)}
        return self._render(h, ast, t, pos)

    def _render(self, h, nodes, t, pos):
        out = []
        for node in nodes:
            if isinstance(node, str):
                out.append(node)
            elif "ref" in node:
                c = derive(t, "pos:%d" % pos[id(node)])
                out.append(self._doc(self._resolve((node["ref"], node["id"])), c))
            else:
                alts = node["choice"]
                rng = SplitMix64(derive(t, "pos:%d" % pos[id(node)]))
                # SPEC 4.2 선택지 뽑기: 보기 가중치로 6.4절 추출 1번. 안 적은 보기는 1(모두 1이면 bounded(보기 수)와 같다)
                a = weighted_sample(rng, node.get("w", [1] * len(alts)), 1)[0]
                if self.trace is not None:
                    self.trace.append(("choice", t, pos[id(node)], a))
                out.append(self._render(h, alts[a], t, pos))
        return "".join(out)


def cleanup(s):
    """SPEC 4.4: 공백뿐인 쉼표 조각을 빼고 앞뒤 공백을 지운다."""
    return ",".join(p for p in s.split(",") if p.strip(BLANK) != "").strip(BLANK)


def expand(bundle, seed, limits=None):
    return Expander(bundle, limits).expand(seed)
