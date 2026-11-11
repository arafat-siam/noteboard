import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/db';
import { ancestors, isVisible } from '../db/library';
import type { ID, LibraryItem, Notebook } from '../model/types';
import { Modal } from './Dialogs';

/** Picks the notebook a page is copied to (any notebook, including this one). */
export function CopyPageDialog(props: {
  currentNotebookId: ID;
  onCopy: (targetNotebookId: ID) => void;
  onClose: () => void;
}) {
  const items = useLiveQuery(() => db.items.toArray(), []);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<ID>(props.currentNotebookId);

  const notebooks = useMemo(() => {
    if (!items) return [];
    const byId = new Map<ID, LibraryItem>(items.map((i) => [i.id, i]));
    return items
      .filter((i): i is Notebook => i.kind === 'notebook' && !i.deleted && isVisible(byId, i.id))
      .map((n) => ({
        notebook: n,
        path: ancestors(byId, n.parentId)
          .map((f) => f.name)
          .join(' › '),
      }))
      .filter(({ notebook, path }) => `${notebook.name} ${path}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => {
        // This notebook first, then by most recently opened.
        if (a.notebook.id === props.currentNotebookId) return -1;
        if (b.notebook.id === props.currentNotebookId) return 1;
        return (b.notebook.lastOpenedAt ?? 0) - (a.notebook.lastOpenedAt ?? 0);
      });
  }, [items, query, props.currentNotebookId]);

  return (
    <Modal title="Copy page to…" onClose={props.onClose}>
      <input
        className="search-input"
        type="search"
        placeholder="Search notebooks"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tree-picker">
        {notebooks.map(({ notebook, path }) => (
          <button
            key={notebook.id}
            className={`tree-row ${target === notebook.id ? 'selected' : ''}`}
            onClick={() => setTarget(notebook.id)}
          >
            <span className="cover-dot" style={{ background: notebook.coverColor }} />
            <span>
              {notebook.name}
              {notebook.id === props.currentNotebookId && <span className="muted"> · this notebook</span>}
              {path && <span className="muted tree-path"> · {path}</span>}
            </span>
          </button>
        ))}
        {!notebooks.length && <p className="muted">No notebooks found.</p>}
      </div>
      <div className="modal-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button
          className="primary"
          onClick={() => {
            props.onCopy(target);
            props.onClose();
          }}
        >
          Copy Here
        </button>
      </div>
    </Modal>
  );
}
