// 와카아카 노드의 화면 쪽 (DESIGN 8절). 설정 두 개, 정보 줄, 읽기 전용 text, 접힌 lock, "웹에서 열기" 버튼.
// 결과를 채우는 것은 서버 훅이고, 여기서는 훅이 보낸 값(wakaaka.fill)을 위젯에 반영만 한다.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "WakaakaWildcard";
const DEFAULT_URL = "https://wakaaka.baepoyong.com"; // wakaaka_node/settings.py DEFAULT_URL과 같게
const ID12 = /^[0-9A-Za-z]{12}$/;
const URL_ID = /\/w\/([0-9A-Za-z]{12})(?![0-9A-Za-z])/;

function extractId(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (ID12.test(s)) return s;
  const m = URL_ID.exec(s);
  return m ? m[1] : null;
}

function serverUrl() {
  const raw = app.extensionManager?.setting?.get("Wakaaka.ServerUrl") ?? DEFAULT_URL;
  try {
    const u = new URL(String(raw).trim());
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && !u.search && !u.hash) {
      return u.href.replace(/\/+$/, "");
    }
  } catch {}
  return null;
}

function parseLock(value) {
  try {
    const v = JSON.parse(value);
    if (v && typeof v === "object" && v.lock && typeof v.lock === "object") return v;
  } catch {}
  return null;
}

function lockSummary(node) {
  const id = extractId(widget(node, "wildcard")?.value);
  const v = parseLock(widget(node, "lock")?.value);
  if (!id || !v || !Object.hasOwn(v.lock, id)) return "lock 없음 · 큐에 넣으면 채워짐";
  const n = Object.keys(v.lock).length - 1;
  const ver = Number.isInteger(v.v) ? `v${v.v}` : "버전 모름";
  const sub = n > 0 ? ` · 하위 ${n}개` : "";
  const cached = node.wakaakaSource === "cache" ? " · 서버에 연결하지 못해 캐시로 전개함" : "";
  return (widget(node, "follow_latest")?.value === false ? `${ver}에 고정${sub}` : `${ver}${sub} · 큐에 넣을 때 최신으로 갱신`) + cached;
}

const widget = (node, name) => node.widgets?.find((w) => w.name === name);

// ---------------------------------------------------------------- 이름·소유자·버전 (/wakaaka/meta)

const metaCache = new Map(); // id -> Promise<응답>

function fetchMeta(id, fresh = false) {
  if (fresh || !metaCache.has(id)) {
    const p = api
      .fetchApi(`/wakaaka/meta?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "ComfyUI에 물어보지 못함" }));
    metaCache.set(id, p);
    p.then((m) => m.ok || metaCache.delete(id)); // 실패는 다음에 다시 묻는다
  }
  return metaCache.get(id);
}

async function refreshInfo(node, fresh = false) {
  const info = node.wakaakaInfo;
  if (!info) return;
  info.lock.textContent = lockSummary(node);
  info.lock.title = widget(node, "lock")?.value || "";
  const id = extractId(widget(node, "wildcard")?.value);
  if (!id) {
    info.meta.textContent = widget(node, "wildcard")?.value ? "ID를 읽을 수 없음 (12자 ID나 웹 주소)" : "와일드카드 ID를 넣으세요";
    return;
  }
  info.meta.textContent = "확인 중…";
  const m = await fetchMeta(id, fresh);
  if (extractId(widget(node, "wildcard")?.value) !== id) return; // 그 사이 바뀜
  info.meta.textContent = m.ok ? `${m.name} · ${m.owner} · v${m.version}` : `${id}: ${m.error}`;
}

// ---------------------------------------------------------------- 노드 꾸미기

function setup(node) {
  const wc = widget(node, "wildcard");
  const text = widget(node, "text");
  const lock = widget(node, "lock");
  const follow = widget(node, "follow_latest");

  // text: 읽기 전용(훅이 채운다)
  if (text?.element) {
    text.element.readOnly = true;
    text.element.style.opacity = "0.85";
    text.element.placeholder = "큐에 넣으면 전개 결과가 채워집니다";
  }
  // lock: 원문은 숨기고 정보 줄에 "v12에 고정"처럼만 보인다
  if (lock) {
    lock.hidden = true;
    lock.options = { ...lock.options, hidden: true };
  }

  const el = document.createElement("div");
  el.style.cssText = "font: 12px sans-serif; line-height: 1.5; padding: 2px 4px; opacity: 0.8; overflow: hidden;";
  const meta = el.appendChild(document.createElement("div"));
  const lockLine = el.appendChild(document.createElement("div"));
  meta.style.cssText = lockLine.style.cssText = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
  const info = node.addDOMWidget("wakaaka_info", "wakaaka_info", el, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => "",
    setValue: () => {},
    // 프론트가 위아래 여백(10px씩)을 빼고 그리므로 두 줄(약 40px)에 20을 더한다
    getMinHeight: () => 60,
    getMaxHeight: () => 60,
  });
  info.serialize = false;
  node.wakaakaInfo = { meta, lock: lockLine };

  const open = node.addWidget("button", "웹에서 열기", null, () => {
    const id = extractId(wc?.value);
    const base = serverUrl();
    if (!id || !base) {
      app.extensionManager?.toast?.add({ severity: "warn", summary: "와카아카", detail: !id ? "와일드카드 ID가 없습니다" : "서버 주소 설정이 올바르지 않습니다", life: 3000 });
      return;
    }
    window.open(`${base}/w/${id}`, "_blank", "noopener");
  });
  open.serialize = false;
  open.options = { ...open.options, serialize: false };

  // 정보 줄을 wildcard 바로 아래로
  const ws = node.widgets;
  ws.splice(ws.indexOf(info), 1);
  ws.splice(ws.indexOf(wc) + 1, 0, info);

  let timer;
  for (const w of [wc, follow]) {
    if (!w) continue;
    const cb = w.callback;
    w.callback = function (...args) {
      const r = cb?.apply(this, args);
      clearTimeout(timer);
      timer = setTimeout(() => refreshInfo(node), 300);
      return r;
    };
  }
  refreshInfo(node);
}

// 실행 ID(서브그래프 안이면 "바깥:안")로 노드를 찾는다
function findNode(execId) {
  let graph = app.rootGraph ?? app.graph;
  let node = null;
  const parts = String(execId).split(":");
  for (let i = 0; i < parts.length; i++) {
    node = graph?.getNodeById?.(Number(parts[i])) ?? graph?.getNodeById?.(parts[i]);
    if (!node) return null;
    if (i < parts.length - 1) graph = node.subgraph;
  }
  return node?.comfyClass === NODE ? node : null;
}

app.registerExtension({
  name: "wakaaka.wildcard",
  settings: [
    {
      id: "Wakaaka.Mode",
      name: "전개 모드",
      category: ["Wakaaka", "노드", "모드"],
      type: "combo",
      defaultValue: "server", // wakaaka_node/settings.py DEFAULT_MODE와 같게
      options: [
        { text: "로컬: 묶음을 받아 이 PC에서 전개", value: "local" },
        { text: "서버: 서버가 전개한 결과를 받음", value: "server" },
      ],
      tooltip: "두 모드의 결과는 같습니다. 로컬은 묶음을 캐시해 오프라인에서도 재현합니다.",
    },
    {
      id: "Wakaaka.ServerUrl",
      name: "서버 주소",
      category: ["Wakaaka", "노드", "서버 주소"],
      type: "text",
      defaultValue: DEFAULT_URL,
      tooltip: "http(s) 주소. 직접 띄운 서버는 예: http://127.0.0.1:3000",
    },
  ],
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const r = created?.apply(this, args);
      setup(this);
      return r;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const r = configured?.apply(this, args);
      refreshInfo(this);
      return r;
    };
  },
  setup() {
    api.addEventListener("wakaaka.fill", ({ detail }) => {
      const node = findNode(detail?.node);
      if (!node) return;
      const text = widget(node, "text");
      const lock = widget(node, "lock");
      if (text) text.value = detail.text;
      if (lock) lock.value = detail.lock;
      node.wakaakaSource = detail.source;
      refreshInfo(node, true);
      node.setDirtyCanvas?.(true, true);
    });
  },
});
