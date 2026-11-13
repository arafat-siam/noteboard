import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import { normalizeUrl } from '../ink/links';
import type { ID, StrokeLink } from '../model/types';
import { Modal } from './Dialogs';

/** The link icon used on badges and in the selection menu. */
export function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </svg>
  );
}

type Tab = StrokeLink['kind'];

/** Add, change or remove the link on the selected items. */
export function LinkDialog(props: { notebookId: ID; link: StrokeLink | null; onSave: (link: StrokeLink | null) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(props.link?.kind ?? 'url');
  const [url, setUrl] = useState(props.link?.kind === 'url' ? props.link.url : '');
  const [pageId, setPageId] = useState(props.link?.kind === 'page' ? props.link.pageId : '');
  const [notebookId, setNotebookId] = useState(props.link?.kind === 'notebook' ? props.link.notebookId : '');
  const [error, setError] = useState('');
  const pageIds = useLiveQuery(async () => {
    const nb = await db.items.get(props.notebookId);
    return nb?.kind === 'notebook' ? nb.pageIds : [];
  }, [props.notebookId]);
  const notebooks = useLiveQuery(
    async () =>
      (await db.items.toArray())
        .filter((i) => i.kind === 'notebook' && !i.deleted && !i.trashedAt && i.id !== props.notebookId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [props.notebookId],
  );

  const save = () => {
    let link: StrokeLink | null = null;
    if (tab === 'url') {
      const clean = normalizeUrl(url);
      if (!clean) return setError('Enter a web address, for example example.com');
      link = { kind: 'url', url: clean };
    } else if (tab === 'page') {
      if (!pageId) return setError('Choose a page.');
      link = { kind: 'page', pageId };
    } else {
      if (!notebookId) return setError('Choose a notebook.');
      link = { kind: 'notebook', notebookId };
    }
    props.onSave(link);
    props.onClose();
  };

  return (
    <Modal title={props.link ? 'Edit link' : 'Add link'} onClose={props.onClose}>
      <div className="segmented" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}>
          Web address
        </button>
        <button className={tab === 'page' ? 'on' : ''} onClick={() => setTab('page')}>
          Page
        </button>
        <button className={tab === 'notebook' ? 'on' : ''} onClick={() => setTab('notebook')}>
          Notebook
        </button>
      </div>
      {tab === 'url' && (
        <>
          <label className="field-label">Address</label>
          <input
            className="text-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="example.com"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </>
      )}
      {tab === 'page' && (
        <div className="link-pages" role="listbox" aria-label="Page">
          {(pageIds ?? []).map((id, i) => (
            <button key={id} role="option" aria-selected={pageId === id} className={pageId === id ? 'on' : ''} onClick={() => setPageId(id)}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
      {tab === 'notebook' && (
        <div className="menu-list link-notebooks" role="listbox" aria-label="Notebook">
          {(notebooks ?? []).map((nb) => (
            <button key={nb.id} role="option" aria-selected={notebookId === nb.id} className={notebookId === nb.id ? 'selected' : ''} onClick={() => setNotebookId(nb.id)}>
              {nb.name}
            </button>
          ))}
          {notebooks && !notebooks.length && <p className="settings-hint">There are no other notebooks yet.</p>}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        {props.link && (
          <button
            className="danger-text link"
            onClick={() => {
              props.onSave(null);
              props.onClose();
            }}
          >
            Remove link
          </button>
        )}
        <span className="spacer" />
        <button onClick={props.onClose}>Cancel</button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
