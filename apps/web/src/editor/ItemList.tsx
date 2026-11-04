// 목록 보기 (DESIGN 11절): 항목마다 행 하나(드래그 손잡이, 가중치, 텍스트, 삭제). 텍스트 칸은 한 줄짜리 CodeMirror이고,
// 포커스가 있는 행에만 띄운다(나머지는 StaticText). 여러 줄을 붙여 넣으면 줄마다 항목이 생긴다.
// 항목 전체가 참조인 행의 펼침 옵션은 여기서만 바꾼다. 항목 순서는 결과와 무관하다(SPEC 4.2 정렬).

import { MAX_WEIGHT } from "@wakaaka/core";
import { Fragment, useMemo, useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { newItemId, type EditItem } from "../lib/editdoc.ts";
import type { EditorContext } from "./cm.ts";
import { ChoiceWeights } from "./ChoiceWeights.tsx";
import { CmEditor } from "./CmEditor.tsx";
import { RefChip, StaticText } from "./StaticText.tsx";
import type { LintContext } from "./syntax.ts";

export interface ItemListProps {
  items: EditItem[];
  onChange?(items: EditItem[]): void;
  context: EditorContext;
  lint: LintContext;
  readOnly?: boolean;
  /** 미리보기에서 마우스를 올린 출처 항목 */
  highlight?: string | null;
  /** 저장 오류가 난 항목 */
  errorItem?: string | null;
}

export function ItemList({ items, onChange, context, lint, readOnly, highlight, errorItem }: ItemListProps) {
  const [active, setActive] = useState<{ id: string; at: number | "end" } | null>(null);
  // 선택지 가중치 패널을 연 항목
  const [weightsFor, setWeightsFor] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  // 포커스가 있는 칸에서 남의 것을 고르면 그 항목에 넣는다
  const activeId = active?.id;
  const rowContext = useMemo((): EditorContext => ({ ...context, onPickOther: (o, f, t) => activeId !== undefined && context.onPickOther(o, f, t, activeId) }), [context, activeId]);
  const set = (next: EditItem[]) => onChange?.(next);
  const taken = () => new Set(items.map((i) => i.id));

  const update = (id: string, patch: Partial<EditItem>) => set(items.map((it) => (it.id === id ? clean({ ...it, ...patch }) : it)));
  const remove = (id: string) => set(items.filter((it) => it.id !== id));
  const insertAfter = (id: string | null, texts: string[], focus: "first" | "last" = "last") => {
    const t = taken();
    const added = texts.map((text) => {
      const nid = newItemId(t);
      t.add(nid);
      return { id: nid, text } as EditItem;
    });
    const at = id === null ? items.length : items.findIndex((i) => i.id === id) + 1;
    set([...items.slice(0, at), ...added, ...items.slice(at)]);
    const target = focus === "first" ? added[0] : added[added.length - 1];
    if (target) setActive({ id: target.id, at: focus === "first" ? 0 : "end" });
  };

  const onDrop = (to: number) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved!);
    set(next);
  };

  return (
    <div className="item-list" role="list">
      {items.map((it, index) => {
        const isRef = it.ref !== undefined;
        const editing = !readOnly && active?.id === it.id && !isRef;
        const cls = ["item-row", highlight === it.id ? "is-highlight" : "", errorItem === it.id ? "is-error" : ""].join(" ");
        return (
          <Fragment key={it.id}>
          <div
            className={cls}
            role="listitem"
            data-item={it.id}
            onDragOver={readOnly ? undefined : (e) => e.preventDefault()}
            onDrop={readOnly ? undefined : onDrop(index)}
          >
            {!readOnly && (
              <span
                className="item-handle"
                draggable
                onDragStart={(e) => {
                  dragFrom.current = index;
                  e.dataTransfer.effectAllowed = "move";
                }}
                title="끌어서 옮기기 (결과에는 영향 없음)"
                aria-hidden="true"
              >
                ⋮⋮
              </span>
            )}
            <WeightInput
              value={it.w}
              disabled={readOnly || (isRef && it.spread === true)}
              onChange={(w) => update(it.id, { w })}
              title={isRef && it.spread ? "펼친 항목은 각자의 가중치를 쓴다" : "가중치 (비우면 1)"}
            />
            <div className="item-text">
              {isRef ? (
                <span className="item-ref">
                  <RefChip id={it.ref!} />
                  <label className="item-spread">
                    <input type="checkbox" checked={it.spread === true} disabled={readOnly} onChange={(e) => update(it.id, { spread: e.target.checked ? true : undefined, ...(e.target.checked ? { w: undefined } : {}) })} />
                    펼치기
                  </label>
                </span>
              ) : editing ? (
                <CmEditor
                  key={it.id}
                  value={it.text ?? ""}
                  onChange={(text) => update(it.id, { text })}
                  context={rowContext}
                  autoFocus={active!.at === "end" ? "end" : active!.at}
                  onBlur={() => setActive((a) => (a?.id === it.id ? null : a))}
                  label={`항목 ${index + 1}`}
                  // CodeMirror 키 처리는 React 이벤트 밖에서 돈다. 바로 커밋해야 이어서 친 글자가 새 칸으로 간다(빠르게 치면 옛 칸에 들어갔다)
                  line={{
                    onEnter: (v) => {
                      const head = v.state.selection.main.head;
                      const text = v.state.doc.toString();
                      const t = taken();
                      const nid = newItemId(t);
                      const next = items.map((x) => (x.id === it.id ? { ...x, text: text.slice(0, head) } : x));
                      next.splice(index + 1, 0, { id: nid, text: text.slice(head) });
                      flushSync(() => {
                        set(next);
                        setActive({ id: nid, at: 0 });
                      });
                      return true;
                    },
                    onBackspaceAtStart: (v) => {
                      if (v.state.doc.length > 0) return false;
                      const prev = items[index - 1];
                      flushSync(() => {
                        remove(it.id);
                        if (prev && prev.ref === undefined) setActive({ id: prev.id, at: "end" });
                      });
                      return true;
                    },
                    onArrow: (_v, dir) => {
                      for (let k = index + dir; k >= 0 && k < items.length; k += dir) {
                        if (items[k]!.ref === undefined) {
                          flushSync(() => setActive({ id: items[k]!.id, at: "end" }));
                          return true;
                        }
                      }
                      return false;
                    },
                    onPasteLines: (v, lines) => {
                      const sel = v.state.selection.main;
                      const text = v.state.doc.toString();
                      const first = text.slice(0, sel.from) + lines[0];
                      const rest = lines.slice(1).filter((l) => l !== "");
                      const last = text.slice(sel.to);
                      const t = taken();
                      const added = rest.map((l, k) => {
                        const nid = newItemId(t);
                        t.add(nid);
                        return { id: nid, text: k === rest.length - 1 ? l + last : l } as EditItem;
                      });
                      const next = items.map((x) => (x.id === it.id ? { ...x, text: rest.length === 0 ? first + last : first } : x));
                      next.splice(index + 1, 0, ...added);
                      const target = added[added.length - 1];
                      flushSync(() => {
                        set(next);
                        if (target) setActive({ id: target.id, at: "end" });
                      });
                    },
                  }}
                  className="item-cm"
                />
              ) : (
                <div
                  className="item-static"
                  tabIndex={readOnly ? undefined : 0}
                  onClick={readOnly ? undefined : () => setActive({ id: it.id, at: "end" })}
                  onFocus={readOnly ? undefined : () => setActive({ id: it.id, at: "end" })}
                >
                  <StaticText text={it.text ?? ""} lint={readOnly ? undefined : lint} />
                </div>
              )}
            </div>
            {!readOnly && !isRef && (it.text ?? "").includes("{") && (
              <button
                type="button"
                className="btn btn-ghost btn-sm item-weights"
                aria-expanded={weightsFor === it.id}
                onClick={() => setWeightsFor(weightsFor === it.id ? null : it.id)}
                title="선택지 보기 가중치"
                aria-label="선택지 보기 가중치"
              >
                ⚖
              </button>
            )}
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm item-delete" onClick={() => remove(it.id)} title="항목 삭제" aria-label="항목 삭제">
                ×
              </button>
            )}
          </div>
          {!readOnly && weightsFor === it.id && it.text !== undefined && (
            <ChoiceWeights text={it.text} onChange={(text) => update(it.id, { text })} onClose={() => setWeightsFor(null)} />
          )}
          </Fragment>
        );
      })}
      {!readOnly && (
        <div className="item-add">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => insertAfter(null, [""])}>
            + 항목
          </button>
        </div>
      )}
    </div>
  );
}

/** 펼침이 켜지면 w를 지운다(SPEC 3.1: spread 항목에는 w를 쓸 수 없다). 값이 undefined인 키는 없앤다 */
function clean(it: EditItem): EditItem {
  const out: EditItem = { id: it.id };
  if (it.text !== undefined) out.text = it.text;
  if (it.ref !== undefined) out.ref = it.ref;
  if (it.spread !== undefined) out.spread = it.spread;
  if (it.w !== undefined && !(it.ref !== undefined && it.spread === true)) out.w = it.w;
  return out;
}

function WeightInput({ value, onChange, disabled, title }: { value: number | undefined; onChange(w: number | undefined): void; disabled?: boolean; title: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const bad = draft !== null && draft !== "" && !(/^[0-9]{1,7}$/.test(draft) && Number(draft) <= MAX_WEIGHT);
  return (
    <input
      className={"input input-sm item-weight" + (bad ? " is-invalid" : "")}
      inputMode="numeric"
      placeholder="1"
      value={shown}
      disabled={disabled}
      title={bad ? `0~${MAX_WEIGHT} 정수` : title}
      aria-label="가중치"
      onChange={(e) => {
        const s = e.target.value.trim();
        setDraft(s);
        if (s === "") onChange(undefined);
        else if (/^[0-9]{1,7}$/.test(s) && Number(s) <= MAX_WEIGHT) onChange(Number(s));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
