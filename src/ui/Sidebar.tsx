import { useRef, useState, type ReactNode } from 'react';
import type { Route } from '../App';
import { db } from '../db/db';
import { moveItems } from '../db/library';
import { exportBackup, importBackup, shareOrDownload } from '../export/exporters';
import type { ID } from '../model/types';
import { act, useLibrary } from './useLibrary';
import { FolderGlyph } from './Dialogs';
import { SyncBadge } from './SyncBadge';
import { readDragIds } from './dnd';

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const library = useLibrary();
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dropProps = (key: string, folderId: ID | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const ids = readDragIds(e);
      if (ids.length) void act(() => moveItems(db, ids, folderId));
    },
  });

  const isActive = (r: Route) => JSON.stringify(r) === JSON.stringify(route);

  const navItem = (label: ReactNode, r: Route, extra?: ReactNode) => (
    <button className={`nav-item ${isActive(r) ? 'active' : ''}`} onClick={() => onNavigate(r)}>
      {label}
      {extra}
    </button>
  );

  const tree = (parentId: ID | null, depth: number): ReactNode =>
    library?.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((f) => {
        const hasChildren = library.folders.some((c) => c.parentId === f.id);
        const open = expanded.has(f.id);
        return (
          <div key={f.id}>
            <div
              className={`tree-item ${isActive({ view: 'library', folderId: f.id }) ? 'active' : ''} ${
                dropTarget === f.id ? 'drop-target' : ''
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              {...dropProps(f.id, f.id)}
            >
              <button
                className={`disclosure ${hasChildren ? '' : 'hidden'}`}
                aria-label={open ? 'Collapse' : 'Expand'}
                onClick={() =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(f.id)) next.delete(f.id);
                    else next.add(f.id);
                    return next;
                  })
                }
              >
                {open ? '▾' : '▸'}
              </button>
              <button className="tree-label" onClick={() => onNavigate({ view: 'library', folderId: f.id })}>
                <FolderGlyph color={f.color} size={16} /> {f.name}
              </button>
            </div>
            {open && tree(f.id, depth + 1)}
          </div>
        );
      });

  return (
    <aside className="sidebar">
      <div className="sidebar-title">Noteboard</div>
      <nav>
        <div className={`drop-zone ${dropTarget === 'root' ? 'drop-target' : ''}`} {...dropProps('root', null)}>
          {navItem('📚 Library', { view: 'library', folderId: null })}
        </div>
        {navItem('⭐ Favorites', { view: 'favorites' })}
        {navItem('🕘 Recents', { view: 'recents' })}
        {navItem('🗑️ Trash', { view: 'trash' }, library?.trashed.length ? <span className="count">{library.trashed.length}</span> : null)}
      </nav>

      <div className="sidebar-section">Folders</div>
      <div className="tree">{tree(null, 0)}</div>

      {!!library?.tags.length && (
        <>
          <div className="sidebar-section">Tags</div>
          <nav>{library.tags.map((tag) => navItem(`# ${tag}`, { view: 'tag', tag }))}</nav>
        </>
      )}

      <div className="sidebar-footer">
        <SyncBadge />
        <div className="backup-row">
          <button className="link" onClick={() => void exportBackup(db).then((b) => shareOrDownload(b, `Noteboard backup ${new Date().toISOString().slice(0, 10)}.json`))}>
            Export backup
          </button>
          <button className="link" onClick={() => fileInput.current?.click()}>
            Import backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void act(async () => alert(`Imported ${await importBackup(db, file)} items.`));
            }}
          />
        </div>
      </div>
    </aside>
  );
}
