// 편집기 칸에 넘기는 바깥 상태: 오류 검사용 내 와일드카드, 칩 이름, `${` 자동완성 후보(내 것 → 즐겨찾기 → 둘러보기),
// 쉼표 뒤 태그 자동완성과 태그 표기 lint.

import { useMemo } from "react";
import { examplesOf, getMeta, requestMeta, useMetaVersion } from "../app/cache.ts";
import { suggestTags, tagLookup } from "../app/tags.ts";
import { navigate } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import { api, type Card } from "../lib/api.ts";
import { mineByName } from "../lib/names.ts";
import type { EditorContext, RefOption } from "./cm.ts";
import { chipLabel } from "./StaticText.tsx";
import { tagLint } from "./tags.ts";

const EXPLORE_TTL = 30_000;
const exploreCache = new Map<string, { at: number; p: Promise<Card[]> }>();

function exploreOptions(query: string): Promise<Card[]> {
  const hit = exploreCache.get(query);
  if (hit && Date.now() - hit.at < EXPLORE_TTL) return hit.p;
  const p = api
    .explore({ q: query })
    .then((r) => r.wildcards)
    .catch(() => []);
  exploreCache.set(query, { at: Date.now(), p });
  return p;
}

const matches = (name: string, q: string) => name.toLowerCase().includes(q);
const rank = (name: string, q: string) => (name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : 2);

export interface EditorContextOptions {
  /** 편집 중인 와일드카드(자기 자신은 후보에서 뺀다) */
  selfId?: string;
  /** 남의 것: 참조 검사·자동완성 없이 보기만 */
  readOnly?: boolean;
  onPickOther?(option: RefOption, from: number, to: number): void;
}

export function useEditorContext(o: EditorContextOptions): EditorContext {
  const { mine, favorites } = useSession();
  const metaVersion = useMetaVersion();
  return useMemo((): EditorContext => {
    const lint = o.readOnly
      ? { mineIds: null, mineNames: null }
      : { mineIds: new Set(mine.map((w) => w.id)), mineNames: mineByName(mine), extra: (text: string) => tagLint(text, tagLookup) };
    return {
      lint,
      chip: (id) => {
        requestMeta([id]);
        return chipLabel(id);
      },
      peek: (id) => {
        const m = getMeta(id);
        if (!m) return null;
        return {
          title: m.name,
          sub: `${m.owner}${m.forkedFrom?.owner ? ` · 원작자 ${m.forkedFrom.owner}` : ""} · v${m.version}`,
          description: m.description,
          examples: examplesOf(id, m.version),
        };
      },
      onNavigate: (id) => navigate({ name: "wildcard", id }),
      refOptions: o.readOnly
        ? null
        : async (query) => {
            const q = query.trim().toLowerCase();
            const seen = new Set<string>(o.selfId ? [o.selfId] : []);
            const out: RefOption[] = [];
            const push = (xs: Array<{ id: string; name: string; owner: string }>, section: RefOption["section"], own: boolean, limit: number) => {
              const picked = xs
                .filter((w) => !seen.has(w.id) && matches(w.name, q))
                .sort((a, b) => rank(a.name, q) - rank(b.name, q) || a.name.localeCompare(b.name))
                .slice(0, limit);
              for (const w of picked) {
                seen.add(w.id);
                out.push({ id: w.id, name: w.name, owner: own ? null : w.owner, section });
              }
            };
            push(mine, "mine", true, 30);
            push(favorites, "favorite", false, 15);
            const ex = await exploreOptions(q);
            // 둘러보기에는 내 것도 나온다. 내 것은 위에서 이미 다뤘다
            push(
              ex.filter((w) => !mine.some((m) => m.id === w.id)),
              "explore",
              false,
              10,
            );
            return out;
          },
      onPickOther: o.onPickOther ?? (() => {}),
      tagOptions: o.readOnly ? null : suggestTags,
    };
    // metaVersion: 칩 이름이 도착하면 다시 그린다.
    // 태그 조회(표기 lint)가 도착해도 컨텍스트는 바꾸지 않는다: 바꾸면 CodeMirror 설정을 다시 걸면서 열린 자동완성이 닫힌다(실측).
    // 대신 CmEditor가 lint만 다시 돌리고, 정적 칸은 스스로 다시 그린다(useTagVersion)
  }, [mine, favorites, metaVersion, o.readOnly, o.selfId, o.onPickOther]);
}
