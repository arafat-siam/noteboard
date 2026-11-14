import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import { setNotebookSettings } from '../db/library';
import { loadPages } from '../db/pages';
import { setTapeRevealed } from '../ink/render';
import { newId, type Bookmark, type Notebook, type Stroke } from '../model/types';
import { sync } from '../sync/instance';
import { Icon } from './Icon';

/**
 * Contents: the notebook's bookmarked pages with their titles. Bookmark the page on screen,
 * rename or remove bookmarks, and jump to any of them.
 */
export function ContentsPanel(props: {
  notebook: Notebook;
  currentPageId: () => string | undefined;
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
}) {
  const { notebook } = props;
  const marks = (notebook.bookmarks ?? [])
    .filter((b) => notebook.pageIds.includes(b.pageId))
    .sort((a, b) => notebook.pageIds.indexOf(a.pageId) - notebook.pageIds.indexOf(b.pageId) || a.createdAt - b.createdAt);
  const save = (bookmarks: Bookmark[], removed: string[] = []) =>
    void setNotebookSettings(db, notebook.id, {
      bookmarks,
      deletedBookmarkIds: [...new Set([...(notebook.deletedBookmarkIds ?? []), ...removed])],
    }).then(() => sync.syncSoon());

  const addCurrent = () => {
    const pageId = props.currentPageId();
    if (!pageId) return;
    const n = notebook.pageIds.indexOf(pageId) + 1;
    const title = prompt('Bookmark title', `Page ${n}`)?.trim();
    if (!title) return;
    save([...(notebook.bookmarks ?? []), { id: newId(), pageId, title: title.slice(0, 80), createdAt: Date.now() }]);
  };

  return (
    <aside className="find-panel" aria-label="Contents">
      <div className="find-head">
        <span className="panel-title">
          <Icon name="toc" size={18} /> Contents
        </span>
        <button className="header-icon" aria-label="Close contents" onClick={props.onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="find-results">
        {marks.length === 0 && <p className="find-empty">No bookmarks yet. Bookmark pages to build this notebook's table of contents.</p>}
        {marks.map((b) => (
          <div key={b.id} className="contents-row">
            <button className="find-result" onClick={() => props.onOpenPage(b.pageId)}>
              <span className="find-result-page">
                <Icon name="bookmark" size={14} /> Page {notebook.pageIds.indexOf(b.pageId) + 1}
              </span>
              <span className="find-result-snippet">{b.title}</span>
            </button>
            <button
              className="preset-tool"
              aria-label={`Rename ${b.title}`}
              title="Rename"
              onClick={() => {
                const title = prompt('Bookmark title', b.title)?.trim();
                if (title) save((notebook.bookmarks ?? []).map((x) => (x.id === b.id ? { ...x, title: title.slice(0, 80) } : x)));
              }}
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              className="preset-tool"
              aria-label={`Remove ${b.title}`}
              title="Remove"
              onClick={() => save((notebook.bookmarks ?? []).filter((x) => x.id !== b.id), [b.id])}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="panel-foot">
        <button className="preset-new" onClick={addCurrent}>
          <Icon name="bookmark" size={16} /> Bookmark this page
        </button>
      </div>
    </aside>
  );
}

interface Card {
  pageId: string;
  tape: Stroke;
}

/** Card order: page by page, top to bottom, left to right. */
function topLeft(s: Stroke): [number, number] {
  let x = Infinity;
  let y = Infinity;
  for (let i = 0; i < s.points.length; i += 3) {
    x = Math.min(x, s.points[i]!);
    y = Math.min(y, s.points[i + 1]!);
  }
  return [x, y];
}

/**
 * Flashcards: every piece of tape in the notebook is a card. All tape is covered, and the
 * cards are shown one by one: Reveal shows the answer under the tape, Next moves on.
 */
export function FlashcardPanel(props: {
  notebook: Notebook;
  onShowCard: (pageId: string, y: number) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void loadPages(db, props.notebook.pageIds).then((pages) => {
      if (!alive) return;
      const found: Card[] = [];
      for (const page of pages) {
        if (!page) continue;
        const tapes = page.strokes.filter((s) => s.tool === 'tape');
        tapes.sort((a, b) => topLeft(a)[1] - topLeft(b)[1] || topLeft(a)[0] - topLeft(b)[0]);
        for (const tape of tapes) found.push({ pageId: page.id, tape });
      }
      setTapeRevealed(found.map((c) => c.tape.id), false);
      setCards(found);
    });
    return () => {
      alive = false;
    };
  }, [props.notebook.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = cards?.[index];
  useEffect(() => {
    if (!card) return;
    setRevealed(false);
    setTapeRevealed([card.tape.id], false);
    props.onShowCard(card.pageId, topLeft(card.tape)[1]);
  }, [card?.tape.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = useMemo(() => (cards ?? []).filter((c) => !known.has(c.tape.id)).length, [cards, known]);
  const go = (step: number) => cards && setIndex((i) => (i + step + cards.length) % cards.length);

  return (
    <aside className="find-panel flashcards" aria-label="Flashcards">
      <div className="find-head">
        <span className="panel-title">
          <Icon name="cards" size={18} /> Flashcards
        </span>
        <button className="header-icon" aria-label="Close flashcards" onClick={props.onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {cards === null ? (
        <p className="find-empty">Loading cards…</p>
      ) : cards.length === 0 ? (
        <p className="find-empty">There are no cards in this notebook. Use the tape tool to cover answers; each piece of tape becomes a card.</p>
      ) : (
        <div className="flashcard-body">
          <div className="flashcard-count">
            Card {index + 1} of {cards.length} · Page {props.notebook.pageIds.indexOf(card!.pageId) + 1}
            {known.size > 0 && <span className="muted"> · {remaining} left to learn</span>}
          </div>
          <button
            className="primary flashcard-reveal"
            onClick={() => {
              const next = !revealed;
              setRevealed(next);
              setTapeRevealed([card!.tape.id], next);
            }}
          >
            <Icon name={revealed ? 'eraser' : 'search'} size={18} /> {revealed ? 'Cover answer' : 'Reveal answer'}
          </button>
          <div className="flashcard-actions">
            <button className="secondary" onClick={() => go(-1)} aria-label="Previous card">
              <Icon name="chevronLeft" size={18} /> Previous
            </button>
            <button
              className="secondary"
              onClick={() => {
                setKnown((k) => new Set(k).add(card!.tape.id));
                go(1);
              }}
            >
              <Icon name="check" size={18} /> I knew it
            </button>
            <button className="secondary" onClick={() => go(1)} aria-label="Next card">
              Next <Icon name="chevronRight" size={18} />
            </button>
          </div>
          <button
            className="link"
            onClick={() => {
              setCards((c) => (c ? [...c].sort(() => Math.random() - 0.5) : c));
              setIndex(0);
              setKnown(new Set());
            }}
          >
            Shuffle and start again
          </button>
        </div>
      )}
    </aside>
  );
}
