// 와일드카드 상세 (DESIGN 11절): 내 것이면 편집기, 남의 것(또는 내 것의 옛 버전)이면 읽기 전용 보기.
// 가운데: 이름·분류·설명·상태, 개수·구분자·보기 전환, 목록 보기/텍스트 보기. 오른쪽: 미리보기, 사용하는 것, 사용되는 곳, 버전 이력.

import { isFixedDoc, type SourceRange } from "@wakaaka/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { getBundle, getMeta, invalidate, primeMeta, requestMeta, useMetaVersion } from "../app/cache.ts";
import { Link, navigate, navigateBack } from "../app/router.tsx";
import { useTabs } from "../app/tabs.tsx";
import { keyOf, type TabKey } from "../lib/tabs.ts";
import { useSession } from "../app/session.tsx";
import { ImportDialog, PickRefDialog } from "../components/Dialogs.tsx";
import { FixedBadge } from "../components/FixedBadge.tsx";
import { GuideButton } from "../components/Guide.tsx";
import { useToast } from "../components/Toast.tsx";
import type { RefOption } from "../editor/cm.ts";
import { CmEditor } from "../editor/CmEditor.tsx";
import { ItemList } from "../editor/ItemList.tsx";
import { Dependents as DependentsPanel, DepTree as DepTreePanel, VersionHistory as VersionPanel } from "../editor/Panels.tsx";
import { ExportPanel } from "../editor/ExportPanel.tsx";
import { Preview } from "../editor/Preview.tsx";
import { syntaxMessage } from "../editor/syntax.ts";
import { useEditorContext } from "../editor/useEditorContext.ts";
import { api, ApiError, type Card, type Warning, type WildcardDetail } from "../lib/api.ts";
import { CATEGORIES, categoryLabel } from "../lib/categories.ts";
import { clearDraft, loadDraft, saveDraft, type Draft } from "../lib/drafts.ts";
import { DEFAULT_COUNT, DEFAULT_SEP, fromDoc, sameDoc, toDoc, type EditDoc, type EditItem } from "../lib/editdoc.ts";
import { mineByName, nameKey, nameRefs, rewriteItems } from "../lib/names.ts";
import { buildPreviewBundle, dependencyTree, directRefs, type BundleLike } from "../lib/preview.ts";
import { canUseTextView, itemsToText, textToItems } from "../lib/textview.ts";
import type { ToastInput } from "../lib/toasts.ts";

/** tabKey: 이 화면이 든 탭, active: 지금 보이는 탭인지(Ctrl+S 등은 보이는 탭만) */
export function WildcardPage({ id, tabKey, active }: { id: string | null; tabKey: TabKey; active: boolean }) {
  const { user } = useSession();
  const [detail, setDetail] = useState<WildcardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState<number | undefined>(undefined);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setSeq(undefined);
  }, [id]);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    setError(null);
    api
      .get(id, seq)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        primeMeta([{ ...d, liked: d.viewer.liked, favorited: d.viewer.favorited }]);
      })
      .catch((e) => live && setError(e instanceof ApiError && e.status === 404 ? "와일드카드를 찾을 수 없습니다(지워졌거나 없는 ID)" : String(e)));
    return () => {
      live = false;
    };
  }, [id, seq, reload]);

  if (id === null) {
    if (user === undefined) return <p className="page-pad text-muted">불러오는 중…</p>;
    if (user === null) return <NeedLogin />;
    return <Editor key="new" detail={null} tabKey={tabKey} active={active} />;
  }
  if (error) return <p className="page-pad text-danger">{error}</p>;
  if (!detail || detail.id !== id || user === undefined) return <p className="page-pad text-muted">불러오는 중…</p>;
  const mine = user !== null && detail.owner.toLowerCase() === user.toLowerCase();
  if (mine && detail.seq === detail.version) return <Editor key={detail.id} detail={detail} tabKey={tabKey} active={active} onPickVersion={setSeq} />;
  return <ReadOnly detail={detail} mine={mine} onPickVersion={setSeq} onReload={() => setReload((x) => x + 1)} />;
}

function NeedLogin() {
  return (
    <p className="page-pad">
      와일드카드를 만들려면 <Link to={{ name: "login" }}>로그인</Link>하세요.
    </p>
  );
}

// ---------------------------------------------------------------- 공통: 미리보기 묶음

/** 문서의 하위 묶음을 받아 미리보기 묶음을 만든다 */
function usePreviewBundle(doc: ReturnType<typeof toDoc> | null, selfId: string | undefined, blocked: string | null) {
  const metaVersion = useMetaVersion();
  const [bundle, setBundle] = useState<BundleLike | null>(null);
  const refs = useMemo(() => (doc ? directRefs(doc) : []), [doc]);
  const key = refs.map((r) => `${r}@${getMeta(r)?.version ?? "?"}`).join(",");
  useEffect(() => requestMeta(refs), [refs.join(",")]);
  useEffect(() => {
    if (!doc || blocked) return setBundle(null);
    let live = true;
    void Promise.all(refs.map((r) => getBundle(r, getMeta(r)?.version))).then((bs) => {
      if (live) setBundle(buildPreviewBundle(doc, bs.filter((b): b is BundleLike => b !== null), selfId));
    });
    return () => {
      live = false;
    };
    // key는 하위 ID와 버전, metaVersion은 칩 메타 도착
  }, [doc, key, blocked, selfId, metaVersion]);
  return bundle;
}

// ---------------------------------------------------------------- 편집기 (내 것)

type DialogState =
  | { kind: "pick"; name: string; resolve(card: Card | null): void }
  | { kind: "import"; source: { id: string; name: string; owner: string }; resolve(root: string | null): void }
  | null;

const emptyDoc = (): EditDoc => ({ name: "", items: [] });
const sameCats = (a: number[], b: number[]) => [...a].sort().join(",") === [...b].sort().join(",");

function deterministicRandom() {
  let n = 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    let x = n++;
    for (let i = len - 1; i >= 0; i--) (out[i] = x % 62), (x = Math.floor(x / 62));
    return out;
  };
}

function Editor({ detail, tabKey, active, onPickVersion }: { detail: WildcardDetail | null; tabKey: TabKey; active: boolean; onPickVersion?(seq: number): void }) {
  const tabs = useTabs();
  const { mine, refreshMine } = useSession();
  const id = detail?.id;
  const draftKey = id ?? "new";
  const [base, setBase] = useState(() => ({ doc: detail ? fromDoc(detail.doc) : emptyDoc(), categories: detail?.categories ?? [], seq: detail?.version ?? 0, hash: detail?.hash ?? null }));
  const [doc, setDoc] = useState<EditDoc>(base.doc);
  const [categories, setCategories] = useState<number[]>(base.categories);
  const [mode, setMode] = useState<"list" | "text">("list");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // 제자리 오류 띠: 고칠 때까지 보여야 하는 것(저장 오류, 텍스트 보기 가중치 범위). 나머지 알림은 토스트(사용자 결정 2026-11-09)
  const [message, setMessage] = useState<string | null>(null);
  const toast = useToast();
  const [errorItem, setErrorItem] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [offer, setOffer] = useState<Draft | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const descId = useId();

  const textItems = useCallback((t: string, random?: (n: number) => Uint8Array) => textToItems(doc.items, t, random), [doc.items]);
  /** 텍스트 보기면 그 내용을 항목으로 바꾼 문서 */
  const effective = useMemo((): EditDoc => (mode === "text" ? { ...doc, items: textItems(text, deterministicRandom()).items } : doc), [doc, mode, text, textItems]);
  const dirty = !sameDoc(effective, base.doc) || !sameCats(categories, base.categories);
  /** 편집 중인 내용이 고정인지 (DESIGN 3절 "고정 표시"). 이름 참조도 참조로 본다 */
  const fixed = useMemo(() => isFixedDoc(toDoc(effective), "edit"), [effective]);
  // 탭에 저장 안 함(●)을 알린다. 닫을 때 묻는 것과 페이지를 떠날 때 경고는 탭이 한다
  useEffect(() => tabs.setDirty(tabKey, dirty), [dirty, tabKey, tabs.setDirty]);
  useEffect(() => () => tabs.setDirty(tabKey, false), [tabKey, tabs.setDirty]);

  // 임시 보관: 열 때 있으면 복구를 제안하고, 고치는 동안 저장한다
  useEffect(() => {
    const d = loadDraft(draftKey);
    if (d && !sameDoc(d.doc, base.doc)) setOffer(d);
  }, [draftKey]);
  useEffect(() => {
    if (offer) return; // 제안에 답하기 전에는 덮어쓰지 않는다
    const t = setTimeout(() => {
      if (dirty) saveDraft(draftKey, { baseHash: base.hash, savedAt: new Date().toISOString(), doc: effective, categories });
      else clearDraft(draftKey);
    }, 400);
    return () => clearTimeout(t);
  }, [effective, categories, dirty, draftKey, base.hash, offer]);

  // 이름 참조 → 내 것 ID (미리보기·저장 공통)
  const mineNames = useMemo(() => mineByName(mine), [mine]);
  const unresolved = useMemo(() => [...nameRefs(effective.items)].filter(([k]) => !mineNames.has(k)).map(([, v]) => v), [effective.items, mineNames]);
  const previewDoc = useMemo(() => toDoc({ ...effective, items: rewriteItems(effective.items, (n) => mineNames.get(nameKey(n))) }), [effective, mineNames]);
  const blocked = unresolved.length > 0 ? `이름 참조 ${unresolved.map((n) => "${" + n + "}").join(", ")}는 내 와일드카드에 없습니다. 저장할 때 고릅니다.` : null;
  const bundle = usePreviewBundle(previewDoc, id, blocked);
  const tree = useMemo(() => (bundle ? dependencyTree(bundle) : null), [bundle]);

  // 다이얼로그를 Promise로
  const askPick = (name: string) => new Promise<Card | null>((resolve) => setDialog({ kind: "pick", name, resolve }));
  const askImport = (source: { id: string; name: string; owner: string }) => new Promise<string | null>((resolve) => setDialog({ kind: "import", source, resolve }));

  // 자동완성에서 남의 것을 골랐을 때: 가져오기 → 그 자리에 ${w:복사본}
  const onPickOther = useCallback(
    async (o: RefOption, from: number, to: number, target?: string) => {
      const root = await askImport({ id: o.id, name: o.name, owner: o.owner ?? "" });
      if (!root) return;
      const put = (s: string) => s.slice(0, from) + "${w:" + root + "}" + s.slice(to);
      if (target === undefined) setText((t) => put(t));
      else setDoc((d) => ({ ...d, items: d.items.map((it) => (it.id === target && it.text !== undefined ? { ...it, text: put(it.text) } : it)) }));
    },
    [],
  );
  const context = useEditorContext({ selfId: id, onPickOther });
  // 텍스트 보기 칸: 가져온 결과를 텍스트에 넣는다(target 없음). 객체가 매번 바뀌면 편집기를 매번 다시 설정하므로 고정한다
  const textContext = useMemo(() => ({ ...context, onPickOther: (o: RefOption, f: number, t: number) => void onPickOther(o, f, t) }), [context, onPickOther]);

  const switchMode = (next: "list" | "text") => {
    if (next === mode) return;
    if (next === "text") {
      if (!canUseTextView(doc.items)) return toast({ kind: "warning", text: "줄바꿈이 든 항목이 있어 텍스트 보기를 쓸 수 없습니다." });
      setText(itemsToText(doc.items));
    } else {
      const r = textItems(text);
      if (r.badWeights.length > 0) return setMessage(`가중치는 0~1,000,000입니다 (${r.badWeights.map((i) => i + 1).join(", ")}번째 줄)`);
      setDoc({ ...doc, items: r.items });
    }
    setMessage(null);
    setMode(next);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setErrorItem(null);
    try {
      let items: EditItem[] = doc.items;
      if (mode === "text") {
        const r = textItems(text);
        if (r.badWeights.length > 0) throw new Error(`가중치는 0~1,000,000입니다 (${r.badWeights.map((i) => i + 1).join(", ")}번째 줄)`);
        items = r.items;
      }
      // 이름 참조: 내 것 → 아니면 고르기 → 가져오기 (사용자 결정 2026-11-03)
      const map = new Map(mineNames);
      for (const [key, name] of nameRefs(items)) {
        if (map.has(key)) continue;
        const card = await askPick(name);
        if (!card) return toast({ text: "저장을 취소했습니다." });
        const root = await askImport(card);
        if (!root) return toast({ text: "저장을 취소했습니다." });
        map.set(key, root);
      }
      items = rewriteItems(items, (n) => map.get(nameKey(n)));
      const next: EditDoc = { ...doc, items };
      const stored = toDoc(next);
      const res = id ? await api.save(id, stored, categories) : await api.create(stored, categories);
      clearDraft(draftKey);
      invalidate([res.id]);
      await refreshMine();
      const saved = fromDoc(stored);
      setBase({ doc: saved, categories: [...categories], seq: res.seq, hash: res.hash });
      setDoc(saved);
      if (mode === "text") setText(itemsToText(saved.items));
      setSavedTick((x) => x + 1);
      toast(warningText(res.warnings, res.unchanged));
      if (!id) {
        clearDraft("new");
        // 새 와일드카드 탭이 저장한 와일드카드의 탭이 된다(같은 자리)
        tabs.replace("new", keyOf({ name: "wildcard", id: res.id })!);
        navigate({ name: "wildcard", id: res.id }, { replace: true });
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setMessage(saveErrorText(e));
        if (typeof e.detail.item === "string") setErrorItem(e.detail.item);
      } else setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setDialog(null);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Ctrl+S (⌘S): 보이는 탭만 저장한다(탭마다 편집기가 떠 있다)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (activeRef.current && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const remove = async () => {
    if (!id || !window.confirm(`"${base.doc.name}"을(를) 지울까요? 이 ID를 쓰는 노드도 더는 받지 못합니다.`)) return;
    try {
      await api.remove(id);
      clearDraft(draftKey);
      await refreshMine();
      tabs.close(tabKey, { force: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "E_IN_USE") {
        const deps = (e.detail.dependents as Array<{ name: string }> | undefined)?.map((d) => d.name).join(", ");
        toast({ kind: "error", text: `다른 와일드카드가 쓰고 있어 지울 수 없습니다: ${deps}` });
      } else toast({ kind: "error", text: String(e) });
    }
  };

  // 새 와일드카드 만들기를 그만둔다: 쓴 것이 있으면 한 번 묻고, 임시 보관도 지운 뒤 들어오기 전 화면으로
  const cancelNew = () => {
    if (dirty && !window.confirm("작성 중인 새 와일드카드를 버리고 나갈까요? 임시 보관한 내용도 지웁니다.")) return;
    clearDraft("new");
    setOffer(null);
    tabs.close(tabKey, { force: true, navigate: false });
    navigateBack((r) => r.name === "new");
  };

  const onHover = (s: SourceRange | null) => setHighlight(s && (s.wildcard === null || s.wildcard === id) ? s.item : null);
  const count = doc.count ?? DEFAULT_COUNT;

  return (
    <div className="workspace">
      <main className="editor-pane">
        {offer && (
          <div className="banner banner-info" role="status">
            저장하지 않은 내용이 있습니다 ({new Date(offer.savedAt).toLocaleString("ko-KR")}).
            {offer.baseHash !== base.hash && " 그 뒤 다른 곳에서 새 버전이 저장되었습니다."}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setDoc(offer.doc);
                setCategories(offer.categories);
                setMode("list");
                setOffer(null);
              }}
            >
              복구
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                clearDraft(draftKey);
                setOffer(null);
              }}
            >
              버리기
            </button>
          </div>
        )}
        <div className="editor-head">
          <input className="input editor-name" value={doc.name} placeholder="이름" aria-label="이름" maxLength={64 * 2} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
          <div className="editor-status">
            <span className={dirty ? "text-warning" : "text-muted"}>
              {id ? `v${base.seq}` : "새 와일드카드"} · {dirty ? "저장 안 됨" : "저장됨"}
            </span>
            {fixed && <FixedBadge />}
            {id && <CopyId id={id} />}
            <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={saving} title="Ctrl+S">
              {saving ? "저장 중…" : "저장"}
            </button>
            {id ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove()}>
                삭제
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelNew} disabled={saving}>
                취소
              </button>
            )}
          </div>
        </div>
        <CategoryChips value={categories} onChange={setCategories} />
        {/* 설명칸을 항목 입력칸으로 아는 사람이 있었다(사용자 요청 2026-11-09). 라벨을 달고 한 줄로 줄여, 내용은 아래 "항목"에 쓴다는 것을 보인다 */}
        <div className="editor-desc-field">
          <label className="label" htmlFor={descId}>
            설명 <span className="text-muted">선택 · 뽑기에 쓰이지 않음</span>
          </label>
          <textarea
            id={descId}
            className="input editor-desc"
            rows={Math.min(6, (doc.description ?? "").split("\n").length)}
            value={doc.description ?? ""}
            placeholder="둘러보기 카드에 보이는 소개 글 (글자 그대로 보입니다)"
            onChange={(e) => setDoc({ ...doc, description: e.target.value })}
          />
        </div>
        <div className="editor-select">
          <label className="label">
            개수
            <input className="input input-sm editor-num" inputMode="numeric" aria-label="최소 개수" value={count[0]} onChange={(e) => setDoc({ ...doc, count: [toInt(e.target.value), count[1]] })} />~
            <input className="input input-sm editor-num" inputMode="numeric" aria-label="최대 개수" value={count[1]} onChange={(e) => setDoc({ ...doc, count: [count[0], toInt(e.target.value)] })} />
          </label>
          <label className="label">
            구분자
            <input className="input input-sm editor-sep" value={doc.sep ?? ""} placeholder={JSON.stringify(DEFAULT_SEP)} aria-label="구분자" onChange={(e) => setDoc({ ...doc, sep: e.target.value === "" ? undefined : e.target.value })} />
          </label>
          <div className="chip-group" role="group" aria-label="보기">
            <button type="button" className="chip" aria-pressed={mode === "list"} onClick={() => switchMode("list")}>
              목록 보기
            </button>
            <button type="button" className="chip" aria-pressed={mode === "text"} onClick={() => switchMode("text")}>
              텍스트 보기
            </button>
          </div>
          <GuideButton />
        </div>
        <h2 className="editor-section-title">
          항목 <span className="text-muted">{effective.items.length}개</span>
        </h2>
        {message && (
          <div className="banner banner-error" role="alert">
            {message}
          </div>
        )}
        {mode === "list" ? (
          <ItemList items={doc.items} onChange={(items) => setDoc({ ...doc, items })} context={context} lint={context.lint} highlight={highlight} errorItem={errorItem} />
        ) : (
          <div className="text-view">
            <p className="text-muted">
              한 줄에 항목 하나. <code>3* red hair</code>는 가중치 3, <code>*</code>는 빈 항목. 돌아가면 줄을 비교해 항목 ID를 유지합니다.
            </p>
            <CmEditor value={text} onChange={setText} context={textContext} className="text-cm" label="텍스트 보기" textView />
          </div>
        )}
      </main>
      <aside className="side-pane">
        <Preview bundle={bundle} blocked={blocked} selfId={id} selfName={doc.name} onHover={onHover} />
        <ExportPanel bundle={bundle} blocked={blocked} items={effective.items} selfId={id} selfName={doc.name} />
        <DepTreePanel nodes={tree} />
        {id && <DependentsPanel id={id} refreshKey={savedTick} />}
        {id && onPickVersion && <VersionPanel id={id} current={base.seq} latest={base.seq} onPick={(s) => (s === base.seq ? undefined : onPickVersion(s))} refreshKey={savedTick} />}
      </aside>
      {dialog?.kind === "pick" && (
        <PickRefDialog
          name={dialog.name}
          onPick={(c) => {
            dialog.resolve(c);
          }}
          onClose={() => dialog.resolve(null)}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportDialog
          source={dialog.source}
          onDone={(root) => {
            setDialog(null);
            dialog.resolve(root);
          }}
          onClose={() => {
            setDialog(null);
            dialog.resolve(null);
          }}
        />
      )}
    </div>
  );
}

const toInt = (s: string) => {
  const n = Number(s.replace(/[^0-9]/g, "").slice(0, 4));
  return Number.isFinite(n) ? n : 0;
};

function warningText(ws: Warning[], unchanged: boolean): ToastInput {
  if (ws.length === 0) return unchanged ? { kind: "info", text: "바뀐 내용이 없어 새 버전을 만들지 않았습니다." } : { kind: "success", text: "저장했습니다." };
  const name = (id: string) => getMeta(id)?.name ?? id;
  const parts = ws.map((w) =>
    w.code === "W_DEPTH" ? `${name(w.wildcard)}: 깊이 ${w.depth}(상한 16)라 전개가 항상 실패합니다` : w.code === "W_BUNDLE_SIZE" ? `${name(w.wildcard)}: 묶음이 2MB를 넘습니다` : `${name(w.wildcard)}: 후보 가중치 합이 0이 됩니다`,
  );
  return { kind: "warning", text: "저장했지만 경고가 있습니다. " + parts.join(" / ") };
}

function saveErrorText(e: ApiError): string {
  switch (e.code) {
    case "E_SYNTAX": {
      const s = e.detail.syntax as { code?: string } | undefined;
      return `문법 오류: ${syntaxMessage(s?.code ?? "")} (항목 ${String(e.detail.item)})`;
    }
    case "E_REF_NOT_FOUND":
      return "내 와일드카드가 아닌 참조가 있습니다. 자동완성에서 골라 가져오세요.";
    case "E_CYCLE":
      return "참조가 순환합니다: " + ((e.detail.path as string[] | undefined)?.map((id) => getMeta(id)?.name ?? id).join(" → ") ?? "");
    case "E_NAME":
      return "이름: 1~64자, 앞뒤 공백 없이 써 주세요.";
    case "E_NAME_TAKEN":
      return "같은 이름의 와일드카드가 이미 있습니다.";
    case "E_WEIGHT_ZERO":
      return "후보 가중치의 합이 0입니다.";
    case "E_SCHEMA":
      return "문서 형식 오류: " + ((e.detail.issues as Array<{ path: string[]; message: string }> | undefined)?.map((i) => `${i.path.join(".")} ${i.message}`).join(", ") ?? e.message);
    case "E_TOO_LARGE":
      return "문서가 256KB를 넘습니다.";
    case "E_AUTH":
      return "로그인이 풀렸습니다. 다시 로그인해 주세요(내용은 임시 보관되어 있습니다).";
    default:
      return e.message;
  }
}

/** 버튼 글자는 바꾸지 않는다. "복사됨"으로 바꾸면 폭이 줄어 머리줄 줄바꿈이 흔들렸다(사용자 요청 2026-11-09). 알림은 토스트 */
function CopyId({ id }: { id: string }) {
  const toast = useToast();
  const failed = () => toast({ kind: "error", text: "클립보드에 쓸 수 없습니다(브라우저가 막음)" });
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm copy-id"
      title="ComfyUI 노드에 붙여 넣을 ID (누르면 복사)"
      onClick={() => {
        if (!navigator.clipboard) return failed();
        navigator.clipboard.writeText(id).then(() => toast({ kind: "success", text: `ID ${id}를 복사했습니다` }), failed);
      }}
    >
      ID {id}
    </button>
  );
}

function CategoryChips({ value, onChange, readOnly }: { value: number[]; onChange?(v: number[]): void; readOnly?: boolean }) {
  if (readOnly) {
    return value.length === 0 ? null : (
      <div className="chip-group">
        {value.map((c) => (
          <span key={c} className="badge">
            {categoryLabel(c)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="chip-group" role="group" aria-label="분류">
      {CATEGORIES.map((c) => (
        <button key={c.id} type="button" className="chip" aria-pressed={value.includes(c.id)} onClick={() => onChange?.(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id].sort((a, b) => a - b))}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 읽기 전용 (남의 것, 내 것의 옛 버전)

function ReadOnly({ detail, mine, onPickVersion }: { detail: WildcardDetail; mine: boolean; onPickVersion(seq: number | undefined): void; onReload(): void }) {
  const { user, refreshFavorites } = useSession();
  const [likes, setLikes] = useState({ liked: detail.viewer.liked, count: detail.likes });
  const [fav, setFav] = useState(detail.viewer.favorited);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const [highlight, setHighlight] = useState<string | null>(null);
  const context = useEditorContext({ readOnly: true });
  const latest = detail.seq === detail.version;
  useEffect(() => {
    setLikes({ liked: detail.viewer.liked, count: detail.likes });
    setFav(detail.viewer.favorited);
  }, [detail]);

  // 최신이면 그 와일드카드의 묶음, 옛 버전이면 옛 문서 + 하위는 지금 최신
  const [latestBundle, setLatestBundle] = useState<BundleLike | null>(null);
  useEffect(() => {
    let live = true;
    void getBundle(detail.id, detail.version).then((b) => live && setLatestBundle(b));
    return () => {
      live = false;
    };
  }, [detail.id, detail.version]);
  const bundle = useMemo(() => (latestBundle ? (latest ? latestBundle : buildPreviewBundle(detail.doc, [latestBundle], detail.id)) : null), [latestBundle, latest, detail]);
  const tree = useMemo(() => (bundle ? dependencyTree(latest ? { ...bundle, root: bundle.root } : bundle) : null), [bundle, latest]);
  const items = useMemo(() => fromDoc(detail.doc).items, [detail.doc]);
  useEffect(() => requestMeta(directRefs(detail.doc)), [detail.doc]);

  const needLogin = () => toast({ kind: "warning", text: "로그인해야 합니다." });
  const toggleLike = async () => {
    if (!user) return needLogin();
    try {
      const r = await api.like(detail.id, !likes.liked);
      setLikes({ liked: r.liked, count: r.likes });
    } catch (e) {
      toast({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    }
  };
  const toggleFav = async () => {
    if (!user) return needLogin();
    try {
      const r = await api.favorite(detail.id, !fav);
      setFav(r.favorited);
      await refreshFavorites();
    } catch (e) {
      toast({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    }
  };
  const count = detail.doc.select?.count ?? DEFAULT_COUNT;
  const sep = detail.doc.select?.sep ?? DEFAULT_SEP;

  return (
    <div className="workspace">
      <main className="editor-pane">
        {!latest && (
          <div className="banner banner-info" role="status">
            옛 버전 v{detail.seq}을(를) 보고 있습니다(최신 v{detail.version}). 미리보기의 하위 와일드카드는 지금 최신 기준입니다.
            <button type="button" className="btn btn-sm" onClick={() => onPickVersion(undefined)}>
              최신으로
            </button>
          </div>
        )}
        <div className="editor-head">
          <h1 className="wc-title">{detail.doc.name ?? detail.name}</h1>
          <div className="editor-status">
            <span className="text-muted">
              <Link to={{ name: "user", username: detail.owner }}>{detail.owner}</Link> · v{detail.seq}
              {detail.forkedFrom && (
                <>
                  {" "}
                  · 가져옴: <Link to={{ name: "wildcard", id: detail.forkedFrom.wildcard }}>원본</Link>
                  {detail.forkedFrom.owner && ` (${detail.forkedFrom.owner})`}
                </>
              )}
            </span>
            {isFixedDoc(detail.doc) && <FixedBadge />}
          </div>
        </div>
        <div className="readonly-actions">
          {!mine && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" aria-pressed={likes.liked} onClick={() => void toggleLike()}>
                {likes.liked ? "♥" : "♡"} 좋아요 {likes.count}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" aria-pressed={fav} onClick={() => void toggleFav()}>
                {fav ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => (user ? setImporting(true) : needLogin())}>
                가져오기
              </button>
            </>
          )}
          <CopyId id={detail.id} />
          <GuideButton />
        </div>
        <CategoryChips value={detail.categories} readOnly />
        {detail.doc.description && <p className="wc-desc">{detail.doc.description}</p>}
        <p className="text-muted">
          개수 {count[0]}~{count[1]} · 구분자 <code>{JSON.stringify(sep)}</code> · 항목 {items.length}개
        </p>
        <ItemList items={items} context={context} lint={context.lint} readOnly highlight={highlight} />
      </main>
      <aside className="side-pane">
        <Preview bundle={bundle} selfId={detail.id} selfName={detail.doc.name ?? detail.name} onHover={(s) => setHighlight(s && (s.wildcard === null || s.wildcard === detail.id) ? s.item : null)} />
        <ExportPanel bundle={bundle} items={items} selfId={detail.id} selfName={detail.doc.name ?? detail.name} />
        <DepTreePanel nodes={tree} />
        <DependentsPanel id={detail.id} refreshKey={detail.hash} />
        <VersionPanel id={detail.id} current={detail.seq} latest={detail.version} onPick={(s) => onPickVersion(s === detail.version ? undefined : s)} refreshKey={detail.hash} />
      </aside>
      {importing && (
        <ImportDialog
          source={{ id: detail.id, name: detail.doc.name ?? detail.name, owner: detail.owner }}
          onClose={() => setImporting(false)}
          onDone={(root) => {
            setImporting(false);
            navigate({ name: "wildcard", id: root });
          }}
        />
      )}
    </div>
  );
}
