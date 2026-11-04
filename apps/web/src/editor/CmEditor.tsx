// CodeMirror를 그림자 루트 안에 띄우는 React 칸 (DESIGN 10절: CSP 때문에 문서 <style> 대신 생성 스타일시트를 쓰게 한다).
// value가 바깥에서 바뀌면 문서를 바꾸고, 편집하면 onChange로 알린다. 바깥 상태는 editorContext 컴파트먼트로 넘긴다.

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useTagVersion } from "../app/tags.ts";
import { editorContext, relint, setup, type EditorContext, type SetupOptions } from "./cm.ts";

export interface CmEditorProps extends SetupOptions {
  value: string;
  onChange?(value: string): void;
  context: EditorContext;
  autoFocus?: boolean | "end" | number;
  onBlur?(): void;
  onView?(view: EditorView | null): void;
  className?: string;
  label?: string;
}

export function CmEditor(props: CmEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ctxCompartment = useRef(new Compartment());
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current!;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const v = new EditorView({
      root: shadow,
      parent: shadow,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          ctxCompartment.current.of(editorContext.of(props.context)),
          // 키 처리는 마운트할 때 한 번 등록되므로, 항상 최신 props의 처리기를 부르게 한다(목록 상태가 낡지 않게)
          setup({
            readOnly: props.readOnly,
            placeholder: props.placeholder,
            textView: props.textView,
            line: props.line && {
              onEnter: (v) => latest.current.line!.onEnter(v),
              onBackspaceAtStart: (v) => latest.current.line!.onBackspaceAtStart(v),
              onArrow: (v, d) => latest.current.line!.onArrow(v, d),
              onPasteLines: (v, l) => latest.current.line!.onPasteLines(v, l),
            },
          }),
          EditorView.updateListener.of((u) => {
            // 바뀐 글자를 다음 키 입력 전에 React 상태로 커밋한다. 늦게 커밋하면 바로 이어 누른 Ctrl+S가
            // 그 전 상태를 저장한다(실측: 지운 글자가 저장 요청에 남아 있었다). 업데이트 도중에는 커밋할 수 없어 마이크로태스크로 미룬다.
            if (u.docChanged) {
              const text = u.state.doc.toString();
              queueMicrotask(() => flushSync(() => latest.current.onChange?.(text)));
            }
            if (u.focusChanged && !u.view.hasFocus) latest.current.onBlur?.();
          }),
          EditorView.contentAttributes.of({ "aria-label": props.label ?? "편집기" }),
        ],
      }),
    });
    view.current = v;
    props.onView?.(v);
    if (props.autoFocus !== undefined && props.autoFocus !== false) {
      const pos = typeof props.autoFocus === "number" ? Math.min(props.autoFocus, v.state.doc.length) : v.state.doc.length;
      v.dispatch({ selection: { anchor: pos } });
      v.focus();
    }
    return () => {
      latest.current.onView?.(null);
      v.destroy();
      view.current = null;
      // 그림자 루트는 그대로 두고 비운다(다시 붙일 때 attachShadow를 또 부를 수 없다)
      shadow.replaceChildren();
    };
    // 설정(읽기 전용, 한 줄)은 처음 만들 때만 본다. 바꾸려면 key로 다시 만든다
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ctxCompartment.current.reconfigure(editorContext.of(props.context)) });
  }, [props.context]);

  // 표기 lint용 태그 조회가 도착하면 lint만 다시 돌린다(컨텍스트를 바꾸면 열린 자동완성이 닫힌다, useEditorContext)
  const tagVersion = useTagVersion();
  useEffect(() => {
    if (tagVersion > 0) view.current?.dispatch({ effects: relint.of(null) });
  }, [tagVersion]);

  return <div ref={host} className={props.className} />;
}
