import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { onIndexChange } from '../search/indexer';
import { searchText, type TextMatch } from '../search/textIndex';
import { Icon } from './Icon';

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Find in this notebook: handwriting, text boxes and PDF text. Choosing a result scrolls to its
 * page; PDF words are outlined on the page for a few seconds.
 */
export function FindPanel(props: {
  notebookId: string;
  pageIds: string[];
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const run = () =>
      void searchText(q, props.notebookId).then((m) => {
        if (!cancelled) setMatches(m.sort((a, b) => props.pageIds.indexOf(a.pageId) - props.pageIds.indexOf(b.pageId)));
      });
    const timer = window.setTimeout(run, 150);
    const stop = onIndexChange(run);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [query, props.notebookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (m: TextMatch) => {
    props.onOpenPage(m.pageId);
    if (m.source !== 'pdf') return;
    // Outline the matching PDF words once the page is on screen.
    const row = await db.pageText.get(m.pageId);
    const q = fold(query.trim());
    const runs = (row?.pdfRuns ?? []).filter((r) => fold(r.str).includes(q));
    window.setTimeout(() => {
      const index = props.pageIds.indexOf(m.pageId);
      const page = document.querySelectorAll<HTMLElement>('.page-slot')[index]?.querySelector<HTMLElement>('.ink-page');
      if (!page || !row) return;
      const scale = page.getBoundingClientRect().width / (Number(page.dataset.pageWidth) || 1);
      for (const r of runs) {
        const box = document.createElement('div');
        box.className = 'search-hit';
        Object.assign(box.style, {
          left: `${r.x * scale - 2}px`,
          top: `${r.y * scale - 2}px`,
          width: `${r.width * scale + 4}px`,
          height: `${r.height * scale + 4}px`,
        });
        page.appendChild(box);
        window.setTimeout(() => box.remove(), 4_000);
      }
    }, 350);
  };

  return (
    <aside className="find-panel" role="search" aria-label="Find in notebook">
      <div className="find-head">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            placeholder="Find in notebook"
            aria-label="Find in notebook"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
          />
        </label>
        <button className="header-icon" aria-label="Close search" onClick={props.onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="find-results">
        {query.trim().length >= 2 && matches.length === 0 && (
          <p className="find-empty">No matches. Handwriting becomes searchable a few moments after it is written, while Google Drive is connected.</p>
        )}
        {matches.map((m) => (
          <button key={m.pageId} className="find-result" onClick={() => void open(m)}>
            <span className="find-result-page">
              <Icon name={m.source === 'pdf' ? 'fileImport' : m.source === 'typed' ? 'text' : 'pen'} size={14} /> Page {props.pageIds.indexOf(m.pageId) + 1}
            </span>
            <span className="find-result-snippet">
              {m.snippet.before}
              <mark>{m.snippet.match}</mark>
              {m.snippet.after}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
