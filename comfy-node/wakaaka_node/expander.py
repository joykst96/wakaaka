"""노드용 전개기 (docs/SPEC.md 2~6절). TS 전개기와 글자 하나까지 같은 결과를 내야 한다.

공통 테스트 세트(`packages/core/conformance`)로 검증한다. 참조 모델(refmodel.py)과는 따로 짰다.
- 전역 상태(재귀 한도 등)를 바꾸지 않는다. 선택지는 재귀 없이 펼치고, 재귀는 참조 깊이(최대 16)만큼만 쓴다.
- 전개는 데이터만 해석한다. 오류는 ExpandError(코드, 와일드카드 ID)로 낸다.
"""

import re

MAX_NESTING = 64
MAX_WEIGHT = 1_000_000
MAX_ITEMS = 5000
BLANK = " \t\n\r"  # SPEC 1절 "공백"
DEFAULT_LIMITS = {"maxDepth": 16, "maxExpansions": 10000}
M64 = (1 << 64) - 1

_ID12 = re.compile(r"[0-9A-Za-z]{12}")
_ITEM_ID = re.compile(r"[0-9A-Za-z]{1,16}")
_STORED = re.compile(r"w:([0-9A-Za-z]{12})")


class ExpandError(Exception):
    def __init__(self, code, wildcard=None, detail=""):
        super().__init__(code + (f" ({wildcard})" if wildcard else "") + (f": {detail}" if detail else ""))
        self.code = code
        self.wildcard = wildcard


# ---------------------------------------------------------------- 2. 인라인 문법


class Ref:
    __slots__ = ("id", "name", "pos")

    def __init__(self, id, name, pos):
        self.id, self.name, self.pos = id, name, pos


class Choice:
    __slots__ = ("alts", "weights", "explicit", "pos")

    def __init__(self, pos):
        self.alts, self.weights, self.explicit, self.pos = [[]], [1], False, pos


def _ref(body, mode):
    """SPEC 2.3 참조 본문 판정"""
    if body.strip(BLANK) == "":
        raise ExpandError("E_REF_EMPTY")
    if "=" in body:
        raise ExpandError("E_REF_RESERVED")
    if any(c in body for c in "{$\\|"):
        raise ExpandError("E_REF_INVALID")
    if body.startswith("h:"):
        raise ExpandError("E_REF_RESERVED")
    m = _STORED.fullmatch(body)
    if m:
        return m.group(1), None
    if ":" in body:
        raise ExpandError("E_REF_INVALID")
    if mode == "stored":
        raise ExpandError("E_REF_NAME")
    return None, body.strip(BLANK)


def parse(text, mode="stored"):
    """텍스트 → 노드 목록(str, Ref, Choice). 참조·선택지에는 만나는 순서(= 전위 순서)로 번호를 매긴다(SPEC 2.4)."""
    root = []
    cur = root
    stack = []  # (Choice, 바깥 목록)
    buf = []
    count = 0
    i, n = 0, len(text)
    alt_start = False

    def flush():
        if buf:
            s = "".join(buf)
            buf.clear()
            if cur and type(cur[-1]) is str:
                cur[-1] += s
            else:
                cur.append(s)

    while i < n:
        if alt_start:  # 규칙 0: 보기 맨 앞의 [0-9.]+*
            alt_start = False
            j = i
            while j < n and text[j] in "0123456789.":
                j += 1
            if j > i and j < n and text[j] == "*":
                digits = text[i:j]
                d = digits.lstrip("0")
                # 자릿수를 먼저 봐서 아주 긴 숫자에서 int()가 실패하지 않게 한다
                if "." in digits or len(d) > 7 or int(d or "0") > MAX_WEIGHT:
                    raise ExpandError("E_CHOICE_WEIGHT")
                stack[-1][0].weights[-1] = int(d or "0")
                stack[-1][0].explicit = True
                i = j + 1
                continue
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "\\" and nxt != "" and (nxt in "{}$\\" or (stack and nxt == "|")):
            buf.append(nxt)
            i += 2
        elif c == "$" and nxt == "{":
            j = text.find("}", i + 2)
            if j < 0:
                raise ExpandError("E_UNCLOSED_REF")
            wid, name = _ref(text[i + 2 : j], mode)
            flush()
            cur.append(Ref(wid, name, count))
            count += 1
            i = j + 1
        elif c == "{":
            if len(stack) >= MAX_NESTING:
                raise ExpandError("E_NESTING")
            flush()
            node = Choice(count)
            count += 1
            cur.append(node)
            stack.append((node, cur))
            cur = node.alts[0]
            alt_start = True
            i += 1
        elif c == "|" and stack:
            flush()
            node = stack[-1][0]
            node.alts.append([])
            node.weights.append(1)
            cur = node.alts[-1]
            alt_start = True
            i += 1
        elif c == "}":
            if not stack:
                raise ExpandError("E_UNMATCHED_CLOSE")
            flush()
            node, cur = stack.pop()
            if sum(node.weights) == 0:
                raise ExpandError("E_CHOICE_WEIGHT")
            i += 1
        else:
            buf.append(c)
            i += 1
    if stack:
        raise ExpandError("E_UNCLOSED_CHOICE")
    flush()
    return root


def to_common(nodes):
    """SPEC 2.4 공통 표기(공통 테스트 세트 비교용)"""
    out = []
    for node in nodes:
        if type(node) is str:
            out.append(node)
        elif type(node) is Ref:
            out.append({"ref": "w", "id": node.id} if node.id else {"ref": "name", "name": node.name})
        else:
            d = {"choice": [to_common(a) for a in node.alts]}
            if node.explicit:
                d["w"] = list(node.weights)
            out.append(d)
    return out


def refs_in(nodes):
    """뽑히지 않을 보기까지 모든 참조 노드 (재귀 없이)"""
    out, todo = [], [nodes]
    while todo:
        for node in todo.pop():
            if type(node) is Ref:
                out.append(node)
            elif type(node) is Choice:
                todo.extend(node.alts)
    return out


# ---------------------------------------------------------------- 6. 난수와 하위 seed


def mix64(z):
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
    return z ^ (z >> 31)


def fnv1a64(data):
    h = 0xCBF29CE484222325
    for b in data:
        h = ((h ^ b) * 0x100000001B3) & M64
    return h


_label_cache = {}


def _label(label):
    v = _label_cache.get(label)
    if v is None:
        if len(_label_cache) > 100000:
            _label_cache.clear()
        v = _label_cache[label] = mix64(fnv1a64(label.encode("utf-8")))
    return v


def derive(s, label):
    return mix64(s ^ _label(label))


class SplitMix64:
    __slots__ = ("state",)

    def __init__(self, seed):
        self.state = seed & M64

    def next(self):
        self.state = (self.state + 0x9E3779B97F4A7C15) & M64
        return mix64(self.state)

    def bounded(self, n):
        threshold = ((1 << 64) - n) % n
        while True:
            x = self.next()
            if x >= threshold:
                return x % n


def sample(rng, weights, k):
    """6.4절 가중치 비복원 추출. 뽑힌 인덱스를 뽑힌 순서로."""
    rest = list(range(len(weights)))
    total = sum(weights)
    picks = []
    for _ in range(min(k, len(rest))):
        r = rng.bounded(total)
        for p, idx in enumerate(rest):
            w = weights[idx]
            if r < w:
                picks.append(rest.pop(p))
                total -= w
                break
            r -= w
    return picks


def cleanup(s):
    """SPEC 4.4"""
    return ",".join(p for p in s.split(",") if p.strip(BLANK) != "").strip(BLANK)


# ---------------------------------------------------------------- 3. 문서


def _int(v, lo, hi):
    """정수(소수부가 0인 수 포함, 불리언 제외)를 범위 안에서"""
    if type(v) is float and v.is_integer():
        v = int(v)
    if type(v) is not int or not lo <= v <= hi:
        raise ExpandError("E_DOC")
    return v


class Item:
    __slots__ = ("id", "w", "spread", "target", "ast")

    def __init__(self, id, w, spread, target, ast):
        self.id, self.w, self.spread, self.target, self.ast = id, w, spread, target, ast


class Doc:
    __slots__ = ("min", "max", "sep", "items")


def read_doc(raw):
    """SPEC 3.1 검사. 모르는 필드는 무시하고 ref 객체만 엄격히 본다. 텍스트는 이 단계에서 파싱한다."""
    if type(raw) is not dict or "schema" not in raw:
        raise ExpandError("E_DOC")
    _int(raw["schema"], 1, 1)
    sel = raw.get("select", {})
    if type(sel) is not dict:
        raise ExpandError("E_DOC")
    count = sel.get("count", [1, 1])
    if type(count) is not list or len(count) != 2:
        raise ExpandError("E_DOC")
    d = Doc()
    d.min, d.max = _int(count[0], 0, MAX_ITEMS), _int(count[1], 0, MAX_ITEMS)
    if d.min > d.max:
        raise ExpandError("E_DOC")
    d.sep = sel.get("sep", ", ")
    if type(d.sep) is not str:
        raise ExpandError("E_DOC")
    items = raw.get("items")
    if type(items) is not list or len(items) > MAX_ITEMS:
        raise ExpandError("E_DOC")
    seen = set()
    d.items = []
    for it in items:
        if type(it) is not dict:
            raise ExpandError("E_DOC")
        iid = it.get("id")
        if type(iid) is not str or not _ITEM_ID.fullmatch(iid) or iid in seen:
            raise ExpandError("E_DOC")
        seen.add(iid)
        has_text, has_ref = "text" in it, "ref" in it
        if has_text == has_ref:
            raise ExpandError("E_DOC")
        spread = it.get("spread", False)
        if type(spread) is not bool or ("spread" in it and has_text):
            raise ExpandError("E_DOC")
        if spread and "w" in it:
            raise ExpandError("E_DOC")
        w = _int(it.get("w", 1), 0, MAX_WEIGHT)
        if has_text:
            if type(it["text"]) is not str:
                raise ExpandError("E_DOC")
            d.items.append(Item(iid, w, False, None, parse(it["text"])))
        else:
            ref = it["ref"]
            if type(ref) is not dict or list(ref) != ["wildcard"] or type(ref["wildcard"]) is not str or not _ID12.fullmatch(ref["wildcard"]):
                raise ExpandError("E_DOC")
            d.items.append(Item(iid, w, spread, ref["wildcard"], None))
    return d


# ---------------------------------------------------------------- 4. 전개


class Expander:
    """묶음 하나. 만들 때 사전 검사(4.1)를 하고, expand(seed)를 여러 번 부를 수 있다."""

    def __init__(self, bundle, limits=None):
        self.limits = dict(DEFAULT_LIMITS, **(limits or {}))
        if type(bundle) is not dict:
            raise ExpandError("E_FORMAT")
        fmt = bundle.get("format")
        if type(fmt) not in (int, float) or fmt != 1:
            raise ExpandError("E_FORMAT")
        if type(bundle.get("root")) is not str or type(bundle.get("lock")) is not dict or type(bundle.get("docs")) is not dict:
            raise ExpandError("E_FORMAT")
        self.lock = bundle["lock"]
        self.raw = bundle["docs"]
        self.docs = {}
        self.pools = {}
        if bundle["root"] not in self.raw:
            raise ExpandError("E_UNRESOLVED")
        self.root = bundle["root"]
        self._preflight()

    def target(self, wid):
        h = self.lock.get(wid)
        if type(h) is not str or h not in self.raw:
            raise ExpandError("E_UNRESOLVED", wid)
        return h

    def _edges(self, h):
        out = []
        for it in self.docs[h].items:
            if it.target is not None:
                out.append(self.target(it.target))
            else:
                out.extend(self.target(r.id) for r in refs_in(it.ast))
        return out

    def _preflight(self):
        """닿는 문서마다 스키마·문법·참조, 그다음 순환과 깊이 (재귀 없는 DFS)"""
        height, state = {}, {}
        stack = [(self.root, None)]
        while stack:
            h, it = stack[-1]
            if it is None:
                if h not in self.docs:
                    try:
                        self.docs[h] = read_doc(self.raw[h])
                    except ExpandError as e:
                        raise ExpandError(e.code, self._wildcard_of(h)) from None
                state[h] = 1
                it = iter(self._edges(h))
                stack[-1] = (h, it)
            nxt = next(it, None)
            if nxt is None:
                height[h] = max((height[t] + 1 for t in self._edges(h)), default=0)
                state[h] = 2
                stack.pop()
            elif state.get(nxt) == 1:
                raise ExpandError("E_CYCLE", self._wildcard_of(nxt))
            elif nxt not in state:
                stack.append((nxt, None))
        if height[self.root] > self.limits["maxDepth"]:
            raise ExpandError("E_DEPTH")
        for h in self.docs:
            self.pools[h] = self._pool(h)

    def _wildcard_of(self, h):
        return next((k for k, v in self.lock.items() if v == h), None)

    def _pool(self, h):
        """(정렬한 후보 [(key, 문서, 항목)], 가중치, spread 펼치기 횟수). seed와 무관해서 한 번만 만든다."""
        entries, spreads = [], 0
        todo = [(h, ())]
        while todo:  # 문서 순서대로 펼친다(순서는 정렬하므로 결과와 무관)
            dh, prefix = todo.pop(0)
            for it in self.docs[dh].items:
                key = prefix + (it.id,)
                if it.spread:
                    spreads += 1
                    todo.append((self.target(it.target), key))
                else:
                    entries.append((key, dh, it))
        cands = sorted((e for e in entries if e[2].w > 0), key=lambda e: e[0])
        return cands, [e[2].w for e in cands], spreads

    def expand(self, seed):
        if type(seed) is not int or not 0 <= seed <= M64:
            raise ExpandError("E_SEED")
        self.budget = self.limits["maxExpansions"]
        return cleanup(self._doc(self.root, seed))

    def _spend(self, n=1):
        self.budget -= n
        if self.budget < 0:
            raise ExpandError("E_BUDGET")

    def _doc(self, h, c):
        self._spend()
        doc = self.docs[h]
        cands, weights, spreads = self.pools[h]
        if spreads:
            self._spend(spreads)  # 결과는 총량만 본다(넘으면 오류). 펼칠 때마다 쓰는 것과 같다
        rng = SplitMix64(derive(c, "select"))
        k = doc.min + rng.bounded(doc.max - doc.min + 1)
        parts = []
        for i in sample(rng, weights, k):
            key, dh, it = cands[i]
            t = c
            for iid in key:
                t = derive(t, "item:" + iid)
            if it.target is not None:
                s = self._doc(self.target(it.target), derive(t, "pos:0"))
            else:
                s = self._render(it.ast, t)
            if s != "":
                parts.append(s)
        return doc.sep.join(parts)

    def _render(self, nodes, t):
        out = []
        stack = [iter(nodes)]
        while stack:
            node = next(stack[-1], None)
            if node is None:
                stack.pop()
            elif type(node) is str:
                out.append(node)
            elif type(node) is Ref:
                out.append(self._doc(self.target(node.id), derive(t, "pos:%d" % node.pos)))
            else:
                rng = SplitMix64(derive(t, "pos:%d" % node.pos))
                stack.append(iter(node.alts[sample(rng, node.weights, 1)[0]]))
        return "".join(out)


def expand(bundle, seed, limits=None):
    return Expander(bundle, limits).expand(seed)
