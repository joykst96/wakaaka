// 둘러보기 (DESIGN 11절): 검색창, 분류 칩, 인기순(기본)·최신순, 카드 목록. 로그인 없이 보인다. 가져온 복사본은 API가 뺀다.

import { useEffect, useState } from "react";
import { primeMeta } from "../app/cache.ts";
import { Link } from "../app/router.tsx";
import { api, type Card } from "../lib/api.ts";
import { CATEGORIES, categoryLabel } from "../lib/categories.ts";

export function ExplorePage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<number[]>([]);
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    let live = true;
    setCards(null);
    setError(null);
    api
      .explore({ q: query, cat: cats, sort })
      .then((r) => {
        if (!live) return;
        primeMeta(r.wildcards);
        setCards(r.wildcards);
        setNext(r.nextOffset);
      })
      .catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [query, cats, sort]);

  const more = async () => {
    if (next === null) return;
    const r = await api.explore({ q: query, cat: cats, sort, offset: next });
    primeMeta(r.wildcards);
    setCards((c) => [...(c ?? []), ...r.wildcards]);
    setNext(r.nextOffset);
  };

  return (
    <div className="page">
      <h1 className="page-title">둘러보기</h1>
      <div className="explore-controls">
        <input className="input" type="search" placeholder="이름·설명 검색" aria-label="검색" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        <div className="chip-group" role="group" aria-label="정렬">
          <button type="button" className="chip" aria-pressed={sort === "popular"} onClick={() => setSort("popular")}>
            인기순
          </button>
          <button type="button" className="chip" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>
            최신순
          </button>
        </div>
      </div>
      <div className="chip-group" role="group" aria-label="분류">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={cats.includes(c.id)} onClick={() => setCats(cats.includes(c.id) ? cats.filter((x) => x !== c.id) : [...cats, c.id])}>
            {c.label}
          </button>
        ))}
      </div>
      {error && <p className="text-danger">{error}</p>}
      {cards === null && !error && <p className="text-muted">불러오는 중…</p>}
      {cards?.length === 0 && <p className="text-muted">맞는 와일드카드가 없습니다</p>}
      <CardGrid cards={cards ?? []} />
      {next !== null && (
        <button type="button" className="btn btn-secondary" onClick={() => void more()}>
          더 보기
        </button>
      )}
    </div>
  );
}

export function CardGrid({ cards, showOrigin }: { cards: Card[]; showOrigin?: boolean }) {
  return (
    <ul className="card-grid">
      {cards.map((c) => (
        <li key={c.id} className="panel card">
          <div className="card-head">
            <Link to={{ name: "wildcard", id: c.id }} className="card-name">
              {c.name}
            </Link>
            <span className="card-likes" title="좋아요">
              {c.liked ? "♥" : "♡"} {c.likes}
            </span>
          </div>
          <div className="card-meta text-muted">
            <Link to={{ name: "user", username: c.owner }}>{c.owner}</Link>
            {showOrigin && c.forkedFrom && <> · 가져옴({c.forkedFrom.owner ?? "?"})</>}
          </div>
          {c.description && <p className="card-desc">{c.description}</p>}
          {c.categories.length > 0 && (
            <div className="chip-group">
              {c.categories.map((x) => (
                <span key={x} className="badge">
                  {categoryLabel(x)}
                </span>
              ))}
            </div>
          )}
          {c.example !== null && <p className="card-example" title="예시 출력 (seed 0)">{c.example === "" ? "(빈 결과)" : c.example}</p>}
        </li>
      ))}
    </ul>
  );
}
