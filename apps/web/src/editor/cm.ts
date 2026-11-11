// CodeMirror 확장: 구문 색, 참조 칩, 오류 밑줄, `${` 자동완성, 칩 미리보기, 한 줄 칸의 키 처리.
// 바깥(React) 상태는 editorContext 패싯으로 받는다. 상태가 바뀌면 CmEditor가 컴파트먼트를 다시 설정한다.
// DOM은 textContent로만 채운다(innerHTML 없음, DESIGN 9절 7항).

import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState, Facet, Prec, RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, keymap, placeholder as cmPlaceholder, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { FIXED_TITLE } from "../components/FixedBadge.tsx";
import type { TagSuggestion } from "../lib/api.ts";
import { linePrefixLength } from "../lib/textview.ts";
import { diagnose, openRefBefore, tokenize, type LintContext } from "./syntax.ts";
import { formatPostCount, TAG_HOVER_DELAY_EDITOR, tagDisplayName, tagFragmentBefore, tagInfoLines, tagInsertText, tagPieceAt } from "./tags.ts";
import { wakaakaTheme } from "./theme.ts";

export interface ChipInfo {
  name: string;
  /** 가져온 복사본이면 원작자 아이디 */
  origin: string | null;
  missing: boolean;
}

export interface PeekInfo {
  title: string;
  sub: string;
  description: string;
  examples: Promise<string[]>;
}

export interface RefOption {
  id: string;
  name: string;
  /** 내 것이면 null */
  owner: string | null;
  section: "mine" | "favorite" | "explore";
  /** 고정 와일드카드 (DESIGN 3절 "고정 표시"). 후보 이름 앞에 고정 배지를 단다 */
  fixed: boolean;
}

export interface EditorContext {
  lint: LintContext;
  chip(id: string): ChipInfo;
  peek(id: string): PeekInfo | null;
  onNavigate(id: string): void;
  /** `${` 자동완성 후보. null이면 자동완성 없음(읽기 전용) */
  refOptions: ((query: string) => Promise<RefOption[]>) | null;
  /** 남의 것을 골랐을 때: 가져오기 확인 뒤 [from, to)를 `${w:새 ID}`로 바꾼다. target은 목록 보기의 항목 ID(텍스트 보기는 없음) */
  onPickOther(option: RefOption, from: number, to: number, target?: string): void;
  /** 쉼표 뒤 태그 자동완성 후보. null이면 자동완성 없음(읽기 전용) */
  tagOptions: ((query: string) => Promise<TagSuggestion[]>) | null;
  /** 태그 정보 호버: 이름(Danbooru 표기)의 정보, 태그 DB에 없으면 null. 이 필드가 null이면 호버 없음 */
  tagInfo: ((name: string) => Promise<TagSuggestion | null>) | null;
}

const noop = () => {};
export const editorContext = Facet.define<EditorContext, EditorContext>({
  combine: (vs) =>
    vs[vs.length - 1] ?? {
      lint: { mineIds: null, mineNames: null },
      chip: () => ({ name: "?", origin: null, missing: true }),
      peek: () => null,
      onNavigate: noop,
      refOptions: null,
      onPickOther: noop,
      tagOptions: null,
      tagInfo: null,
    },
});

// ---------------------------------------------------------------- 구문 색과 칩

class ChipWidget extends WidgetType {
  readonly id: string;
  readonly info: ChipInfo;
  readonly onNavigate: (id: string) => void;
  constructor(id: string, info: ChipInfo, onNavigate: (id: string) => void) {
    super();
    this.id = id;
    this.info = info;
    this.onNavigate = onNavigate;
  }
  eq(o: ChipWidget) {
    return o.id === this.id && o.info.name === this.info.name && o.info.origin === this.info.origin && o.info.missing === this.info.missing;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "wk-chip" + (this.info.missing ? " wk-chip-missing" : "");
    el.dataset.wildcard = this.id;
    el.textContent = this.info.name;
    if (this.info.origin) {
      const o = document.createElement("span");
      o.className = "wk-chip-origin";
      o.textContent = ` · ${this.info.origin}`;
      el.append(o);
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.onNavigate(this.id);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** 선택지 기호는 겹 수에 따라 세 색을 돌려 쓴다(짝이 맞는 괄호는 같은 색) */
export const depthClass = (depth: number) => "d" + (((depth - 1) % 3) + 1);

const marks = {
  comment: Decoration.mark({ class: "wk-comment" }),
  escape: Decoration.mark({ class: "wk-escape" }),
  nameref: Decoration.mark({ class: "wk-nameref" }),
  foreign: Decoration.mark({ class: "wk-foreign" }),
  weight: Decoration.mark({ class: "wk-weight" }),
  choice: [1, 2, 3].map((d) => Decoration.mark({ class: "wk-choice wk-" + depthClass(d) })),
};

/** 텍스트 보기: 줄 맨 앞의 `3* `(가중치)·`* `는 항목 텍스트가 아니라 줄 형식이다(lib/textview.ts) */
export const lineWeightPrefix = Facet.define<boolean, boolean>({ combine: (vs) => vs.some(Boolean) });
const prefixLength = (view: EditorView, text: string) => (view.state.facet(lineWeightPrefix) ? linePrefixLength(text) : 0);
/** 예전 텍스트 보기 가중치 `3:: ` (2026-11-03 전). 닫는 `::`가 없으면 NAI 강조가 아니라 옛 습관으로 본다 */
const OLD_LINE_WEIGHT = /^[0-9]+::/;

function buildDecorations(view: EditorView): { all: DecorationSet; chips: DecorationSet } {
  const ctx = view.state.facet(editorContext);
  const all = new RangeSetBuilder<Decoration>();
  const chips = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    const skip = prefixLength(view, line.text);
    if (skip > 0) all.add(line.from, line.from + skip, marks.weight);
    for (const t of tokenize(line.text.slice(skip))) {
      const from = line.from + skip + t.from;
      const to = line.from + skip + t.to;
      if (t.type === "wref") {
        const d = Decoration.replace({ widget: new ChipWidget(t.id, ctx.chip(t.id), ctx.onNavigate) });
        all.add(from, to, d);
        chips.add(from, to, d);
      } else if (t.type === "brace" || t.type === "bar") all.add(from, to, marks.choice[(t.depth - 1) % 3]!);
      else if (t.type === "weight") all.add(from, to, marks.weight);
      else if (t.type !== "badref") all.add(from, to, marks[t.type]);
    }
  }
  return { all: all.finish(), chips: chips.finish() };
}

const syntaxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    chips: DecorationSet;
    constructor(view: EditorView) {
      ({ all: this.decorations, chips: this.chips } = buildDecorations(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.startState.facet(editorContext) !== u.state.facet(editorContext)) {
        ({ all: this.decorations, chips: this.chips } = buildDecorations(u.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.chips ?? Decoration.none),
  },
);

// ---------------------------------------------------------------- 오류 밑줄

const lintExtension = linter(
  (view) => {
    const ctx = view.state.facet(editorContext);
    const out: CmDiagnostic[] = [];
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n);
      const skip = prefixLength(view, line.text);
      for (const d of diagnose(line.text.slice(skip), ctx.lint)) {
        const base = line.from + skip;
        const fix = d.fix;
        out.push({
          from: base + d.from,
          to: Math.min(line.to, base + d.to),
          severity: d.severity,
          message: d.message,
          ...(fix && {
            actions: [{ name: "고치기", apply: (v: EditorView) => v.dispatch({ changes: { from: base + fix.from, to: base + fix.to, insert: fix.insert } }) }],
          }),
        });
      }
      const old = view.state.facet(lineWeightPrefix) ? OLD_LINE_WEIGHT.exec(line.text) : null;
      if (old && !line.text.slice(old[0].length).includes("::")) {
        out.push({ from: line.from, to: line.from + old[0].length, severity: "info", message: "텍스트 보기 가중치는 이제 `3* `입니다. `3::`는 글자로 남습니다" });
      }
    }
    return out;
  },
  {
    delay: 150,
    needsRefresh: (u) => u.startState.facet(editorContext) !== u.state.facet(editorContext) || u.transactions.some((tr) => tr.effects.some((e) => e.is(relint))),
  },
);

/**
 * lint만 다시 돌리게 하는 효과(표기 lint용 태그 조회가 도착했을 때, CmEditor).
 * forceLinting은 이미 예약된 검사만 앞당기고 끝난 검사를 다시 돌리지 않는다(@codemirror/lint 소스 `force()`의 `if (this.set)`).
 */
export const relint = StateEffect.define<null>();

// ---------------------------------------------------------------- 칩 미리보기

const peekTooltip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const t = tokenize(line.text).find((t) => t.type === "wref" && line.from + t.from <= pos && pos <= line.from + t.to);
  if (!t || t.type !== "wref") return null;
  const info = view.state.facet(editorContext).peek(t.id);
  if (!info) return null;
  return {
    pos: line.from + t.from,
    end: line.from + t.to,
    above: false,
    create: () => ({ dom: peekDom(info) }),
  };
});

/** 칩 미리보기 DOM: 이름 · 원작자, 설명, 예시 출력 3개 (글자는 모두 textContent) */
export function peekDom(info: PeekInfo): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "wk-peek";
  const title = document.createElement("div");
  title.className = "wk-peek-title";
  title.textContent = info.title;
  const sub = document.createElement("div");
  sub.className = "wk-peek-sub";
  sub.textContent = info.sub;
  dom.append(title, sub);
  if (info.description) {
    const d = document.createElement("div");
    d.textContent = info.description;
    dom.append(d);
  }
  const ex = document.createElement("div");
  ex.className = "wk-peek-example";
  ex.textContent = "예시 불러오는 중…";
  dom.append(ex);
  void info.examples.then((xs) => (ex.textContent = xs.length > 0 ? xs.map((x) => "· " + x).join("\n") : "예시 없음"));
  return dom;
}

// ---------------------------------------------------------------- 자동완성

const SECTION = { mine: { name: "내 와일드카드", rank: 0 }, favorite: { name: "즐겨찾기", rank: 1 }, explore: { name: "둘러보기", rank: 2 } };

const refCompletion: CompletionSource = async (cc: CompletionContext): Promise<CompletionResult | null> => {
  const ctx = cc.state.facet(editorContext);
  if (!ctx.refOptions) return null;
  const line = cc.state.doc.lineAt(cc.pos);
  const open = openRefBefore(line.text.slice(0, cc.pos - line.from));
  if (!open) return null;
  const from = line.from + open.from;
  const options = await ctx.refOptions(open.query);
  if (cc.aborted) return null;
  return {
    from,
    to: cc.pos,
    filter: false,
    options: options.map(
      (o): RefCompletion => ({
        fixed: o.fixed,
        label: "${" + o.name + "}",
        displayLabel: o.name,
        detail: o.owner ? `${o.owner} · 가져오기` : undefined,
        section: SECTION[o.section],
        apply: (view, _c, f, t) => {
          if (o.owner === null) view.dispatch({ changes: { from: f, to: t, insert: "${w:" + o.id + "}" }, selection: { anchor: f + 17 } });
          else ctx.onPickOther(o, f, t);
        },
      }),
    ),
  };
};

/** 참조 후보: 고정이면 이름 앞에 배지 */
interface RefCompletion extends Completion {
  fixed: boolean;
}

/** 이름 앞 고정 배지 (DESIGN 11절 "고정 배지"). 그림자 루트 안이라 앱 CSS 대신 테마의 .wk-fixed-badge로 칠한다 */
const fixedBadgeOption = {
  position: 45,
  render: (c: Completion) => {
    const fixed = (c as Partial<RefCompletion>).fixed;
    if (fixed === undefined) return null; // 태그 후보
    const el = document.createElement("span");
    if (!fixed) {
      // 고정이 아닌 참조 후보도 같은 폭을 비워 이름 줄을 맞춘다
      el.className = "wk-fixed-badge wk-fixed-space";
      el.setAttribute("aria-hidden", "true");
      return el;
    }
    el.className = "wk-fixed-badge";
    el.textContent = "F";
    el.title = FIXED_TITLE;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "고정");
    return el;
  },
};

/** 태그 후보: 분류(색 클래스)와 설명을 같이 들고 다닌다 */
interface TagCompletion extends Completion {
  tag: TagSuggestion;
}
const TAG_TYPE = "wk-tag-";
/** 목록 칸의 짧은 한국어 설명: 한글 본문, 없으면 키워드 */
function tagSummary(t: TagSuggestion): string {
  return tagInfoLines(t).body ?? t.keywords.join(", ");
}

/** 태그 설명 상자: 이름, 분류·포스트 수, 한국어 설명, 키워드 (글자는 모두 textContent). 자동완성 옆 상자와 태그 정보 호버가 같이 쓴다 */
function tagInfoDom(t: TagSuggestion): HTMLElement {
  const lines = tagInfoLines(t);
  const dom = document.createElement("div");
  dom.className = "wk-tag-info";
  const title = document.createElement("div");
  title.className = "wk-tag-info-title " + TAG_TYPE + t.category;
  title.textContent = lines.title;
  const sub = document.createElement("div");
  sub.className = "wk-tag-info-sub";
  sub.textContent = lines.sub;
  dom.append(title, sub);
  if (lines.body !== null) {
    const d = document.createElement("div");
    d.textContent = lines.body;
    dom.append(d);
  }
  if (lines.keywords !== null) {
    const k = document.createElement("div");
    k.className = "wk-tag-info-sub";
    k.textContent = lines.keywords;
    dom.append(k);
  }
  return dom;
}

/** 태그 정보 호버 (DESIGN 11절): 태그 조각에 마우스가 멈추면 태그 DB에 있을 때만 설명 상자. 편집기는 늦게 띄운다 */
const tagTooltip = (hoverTime: number) =>
  hoverTooltip(
    async (view, pos) => {
      const tagInfo = view.state.facet(editorContext).tagInfo;
      if (!tagInfo) return null;
      const line = view.state.doc.lineAt(pos);
      const skip = prefixLength(view, line.text);
      if (pos - line.from < skip) return null;
      const p = tagPieceAt(line.text.slice(skip), pos - line.from - skip);
      if (!p) return null;
      const info = await tagInfo(p.name);
      if (!info) return null;
      const base = line.from + skip;
      return { pos: base + p.from, end: base + p.to, above: false, create: () => ({ dom: tagInfoDom(info) }) };
    },
    // 치거나 커서를 옮기면 닫는다(편집을 가리지 않게)
    { hoverTime, hideOnChange: true },
  );

/** 쉼표 뒤 태그 자동완성 (DESIGN 11절). 영문·한국어로 찾고, 넣을 때 표기를 바꾼다(editor/tags.ts) */
const tagCompletion: CompletionSource = async (cc: CompletionContext): Promise<CompletionResult | null> => {
  const ctx = cc.state.facet(editorContext);
  if (!ctx.tagOptions) return null;
  const line = cc.state.doc.lineAt(cc.pos);
  const skip = cc.state.facet(lineWeightPrefix) ? linePrefixLength(line.text) : 0;
  if (cc.pos - line.from < skip) return null;
  const frag = tagFragmentBefore(line.text.slice(skip, cc.pos - line.from));
  if (!frag || (!cc.explicit && frag.query.trim() === "")) return null;
  const tags = await ctx.tagOptions(frag.query);
  if (cc.aborted || tags.length === 0) return null;
  return {
    from: line.from + skip + frag.from,
    to: cc.pos,
    filter: false,
    options: tags.map(
      (t): TagCompletion => ({
        label: tagInsertText(t.name, frag.inChoice, frag.from === 0),
        displayLabel: tagDisplayName(t.name),
        detail: formatPostCount(t.postCount),
        type: TAG_TYPE + t.category,
        info: () => tagInfoDom(t),
        tag: t,
      }),
    ),
  };
};

/** 목록 칸에 한국어 설명을 한 줄 더 붙인다(태그 후보만) */
const tagSummaryOption = {
  position: 90,
  render: (c: Completion) => {
    const t = (c as Partial<TagCompletion>).tag;
    if (!t) return null;
    const s = tagSummary(t);
    if (s === "") return null;
    const el = document.createElement("span");
    el.className = "wk-tag-summary";
    el.textContent = s;
    return el;
  },
};

// ---------------------------------------------------------------- 조립

export interface LineHandlers {
  onEnter(view: EditorView): boolean;
  onBackspaceAtStart(view: EditorView): boolean;
  onArrow(view: EditorView, dir: -1 | 1): boolean;
  onPasteLines(view: EditorView, lines: string[]): void;
}

export interface SetupOptions {
  readOnly?: boolean;
  placeholder?: string;
  /** 목록 보기의 한 줄 칸 */
  line?: LineHandlers;
  /** 텍스트 보기 칸(줄 맨 앞 가중치 표기를 따로 칠한다) */
  textView?: boolean;
}

export function setup(o: SetupOptions): Extension[] {
  const ext: Extension[] = [wakaakaTheme, syntaxPlugin, lintExtension, peekTooltip, tagTooltip(o.readOnly ? 0 : TAG_HOVER_DELAY_EDITOR), history(), EditorView.lineWrapping, lineWeightPrefix.of(o.textView === true)];
  if (o.placeholder) ext.push(cmPlaceholder(o.placeholder));
  if (o.readOnly) ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  else
    ext.push(
      autocompletion({
        override: [refCompletion, tagCompletion],
        icons: false,
        activateOnTypingDelay: 150,
        // 태그 후보는 분류 색 클래스(wk-tag-<번호>)를 단다
        optionClass: (c) => (c.type?.startsWith(TAG_TYPE) ? c.type : ""),
        addToOptions: [fixedBadgeOption, tagSummaryOption],
      }),
    );
  const line = o.line;
  if (line) {
    ext.push(
      Prec.high(
        keymap.of([
          { key: "Enter", run: (v) => line.onEnter(v) },
          { key: "Backspace", run: (v) => (v.state.selection.main.empty && v.state.selection.main.head === 0 ? line.onBackspaceAtStart(v) : false) },
          { key: "ArrowUp", run: (v) => line.onArrow(v, -1) },
          { key: "ArrowDown", run: (v) => line.onArrow(v, 1) },
        ]),
      ),
      EditorView.domEventHandlers({
        paste: (e, v) => {
          const text = e.clipboardData?.getData("text/plain") ?? "";
          if (!/[\r\n]/.test(text)) return false;
          e.preventDefault();
          line.onPasteLines(v, text.split(/\r\n|\n|\r/));
          return true;
        },
      }),
      // 한 줄 칸: 다른 경로로 들어온 줄바꿈은 공백으로
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
        const text = tr.newDoc.toString().replace(/\r\n|\n|\r/g, " ");
        return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: text }, sequential: true }];
      }),
    );
  }
  ext.push(keymap.of([...defaultKeymap, ...historyKeymap]));
  return ext;
}
