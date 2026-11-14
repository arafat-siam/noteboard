import { useState, type ReactNode } from 'react';
import type { Route } from '../App';
import { db } from '../db/db';
import { moveItems } from '../db/library';
import type { ID } from '../model/types';
import { act, useLibrary } from './useLibrary';
import { FolderGlyph } from './Dialogs';
import { AccountButton } from './AccountButton';
import { readDragIds } from './dnd';
import { Icon, type IconName } from './Icon';
import { SettingsDialog } from './SettingsDialog';

const LOGO = `${import.meta.env.BASE_URL}icon.svg`;

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const library = useLibrary();
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const navItem = (icon: IconName, label: string, r: Route, count?: number) => (
    <button className={`nav-item ${isActive(r) ? 'active' : ''}`} onClick={() => onNavigate(r)}>
      <Icon name={icon} size={20} />
      <span className="nav-label">{label}</span>
      {!!count && <span className="count">{count}</span>}
    </button>
  );

  const counts = {
    favorites: library?.visible.filter((i) => i.favorite).length ?? 0,
    notebooks: library?.visible.filter((i) => i.kind === 'notebook').length ?? 0,
  };

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
              className={`tree-item ${isActive({ view: 'library', folderId: f.id }) ? 'active' : ''} ${dropTarget === f.id ? 'drop-target' : ''}`}
              style={{ paddingLeft: 4 + depth * 14 }}
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
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
              </button>
              <button className="tree-label" onClick={() => onNavigate({ view: 'library', folderId: f.id })}>
                <FolderGlyph color={f.color} size={18} />
                <span>{f.name}</span>
              </button>
            </div>
            {open && tree(f.id, depth + 1)}
          </div>
        );
      });

  const hasFolders = !!library?.folders.length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={LOGO} alt="" width={34} height={34} />
        <span>Noteboard</span>
      </div>
      <nav className="nav-group" aria-label="Library">
        <div className={`drop-zone ${dropTarget === 'root' ? 'drop-target' : ''}`} {...dropProps('root', null)}>
          {navItem('library', 'All notebooks', { view: 'library', folderId: null }, counts.notebooks)}
        </div>
        {navItem('clock', 'Recents', { view: 'recents' })}
        {navItem('star', 'Favorites', { view: 'favorites' }, counts.favorites)}
        {navItem('trash', 'Trash', { view: 'trash' }, library?.trashed.length)}
      </nav>

      {hasFolders && (
        <>
          <div className="sidebar-section">Folders</div>
          <div className="tree">{tree(null, 0)}</div>
        </>
      )}

      {!!library?.tags.length && (
        <>
          <div className="sidebar-section">Tags</div>
          <nav className="nav-group" aria-label="Tags">
            {library.tags.map((tag) => (
              <button key={tag} className={`nav-item ${isActive({ view: 'tag', tag }) ? 'active' : ''}`} onClick={() => onNavigate({ view: 'tag', tag })}>
                <Icon name="tag" size={18} />
                <span className="nav-label">{tag}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="sidebar-footer">
        <AccountButton onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
