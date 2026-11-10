import { useEffect, useMemo, useState } from 'react';
import type { Route } from '../App';
import { db } from '../db/db';
import {
  ancestors,
  createFolder,
  createNotebook,
  moveItems,
  purgeItems,
  renameItem,
  restoreItem,
  setColor,
  setFavorite,
  setTags,
  sortItems,
  trashItems,
  type SortKey,
} from '../db/library';
import { notebookPages } from '../db/pages';
import { exportNotebookPdf, safeFilename, shareOrDownload } from '../export/exporters';
import { COVER_COLORS, FOLDER_COLORS, type ID, type LibraryItem } from '../model/types';
import { ColorRow, FolderGlyph, Modal, MoveDialog, NewNotebookDialog, PromptDialog } from './Dialogs';
import { act, pathOf, useLibrary, type LibraryState } from './useLibrary';
import { readDragIds, writeDragIds } from './dnd';

interface Props {
  route: Route;
  onNavigate: (r: Route) => void;
  onOpenNotebook: (id: ID) => void;
  onToggleSidebar: () => void;
}

type Dialog =
  | { kind: 'new-folder' }
  | { kind: 'new-notebook' }
  | { kind: 'rename'; item: LibraryItem }
  | { kind: 'tags'; item: LibraryItem }
  | { kind: 'color'; item: LibraryItem }
  | { kind: 'move'; ids: ID[] }
  | null;

function usePersisted<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* private mode */
      }
    },
  ];
}

export function LibraryView({ route, onNavigate, onOpenNotebook, onToggleSidebar }: Props) {
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [sort, setSort] = usePersisted<SortKey>('noteboard.sort', 'name');
  const [layout, setLayout] = usePersisted<'grid' | 'list'>('noteboard.layout', 'grid');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuFor, setMenuFor] = useState<ID | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
    setQuery('');
  }, [route]);

  const folderId = route.view === 'library' ? route.folderId : null;

  const { title, items } = useMemo(() => {
    if (!library) return { title: '', items: [] as LibraryItem[] };
    const q = query.trim().toLowerCase();
    if (q) {
      const matches = library.visible.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.kind === 'notebook' && i.tags.some((t) => t.toLowerCase().includes(q))),
      );
      return { title: `Search “${query.trim()}”`, items: sortItems(matches, sort) };
    }
    switch (route.view) {
      case 'library': {
        const folder = route.folderId ? library.byId.get(route.folderId) : undefined;
        return {
          title: folder?.name ?? 'Library',
          items: sortItems(library.visible.filter((i) => i.parentId === route.folderId), sort),
        };
      }
      case 'favorites':
        return { title: 'Favorites', items: sortItems(library.visible.filter((i) => i.favorite), sort) };
      case 'recents':
        return {
          title: 'Recents',
          items: library.visible
            .filter((i) => i.kind === 'notebook' && i.lastOpenedAt)
            .sort((a, b) => (b.kind === 'notebook' ? b.lastOpenedAt ?? 0 : 0) - (a.kind === 'notebook' ? a.lastOpenedAt ?? 0 : 0))
            .slice(0, 40),
        };
      case 'tag':
        return {
          title: `# ${route.tag}`,
          items: sortItems(library.visible.filter((i) => i.kind === 'notebook' && i.tags.includes(route.tag)), sort),
        };
      case 'trash':
        return { title: 'Trash', items: library.trashed };
      default:
        return { title: '', items: [] };
    }
  }, [library, route, query, sort]);

  if (!library) return <div className="loading">Loading…</div>;

  const inTrash = route.view === 'trash' && !query;
  const crumbs = route.view === 'library' && !query ? ancestors(library.byId, folderId) : [];

  const open = (item: LibraryItem) => {
    if (selecting) {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } else if (item.kind === 'folder') onNavigate({ view: 'library', folderId: item.id });
    else onOpenNotebook(item.id);
  };

  const dropOn = (key: string, target: ID | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const ids = readDragIds(e).filter((id) => id !== target);
      if (ids.length) void act(() => moveItems(db, ids, target));
    },
  });

  const exportPdf = async (item: LibraryItem) => {
    if (item.kind !== 'notebook') return;
    const blob = await exportNotebookPdf(item, await notebookPages(db, item.id));
    await shareOrDownload(blob, `${safeFilename(item.name)}.pdf`);
  };

  const selectedIds = [...selected];

  return (
    <div className="library">
      <header className="toolbar library-toolbar">
        <button className="icon-button" aria-label="Toggle sidebar" onClick={onToggleSidebar}>
          ☰
        </button>
        <div className="crumbs">
          {crumbs.length > 0 && (
            <>
              <button
                className={`crumb ${dropTarget === 'crumb-root' ? 'drop-target' : ''}`}
                onClick={() => onNavigate({ view: 'library', folderId: null })}
                {...dropOn('crumb-root', null)}
              >
                Library
              </button>
              {crumbs.slice(0, -1).map((f) => (
                <span key={f.id}>
                  <span className="crumb-sep">›</span>
                  <button
                    className={`crumb ${dropTarget === f.id ? 'drop-target' : ''}`}
                    onClick={() => onNavigate({ view: 'library', folderId: f.id })}
                    {...dropOn(f.id, f.id)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
              <span className="crumb-sep">›</span>
            </>
          )}
          <h1>{title}</h1>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search notebooks, folders, tags"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!inTrash && (
          <>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
              <option value="name">Name</option>
              <option value="updated">Date modified</option>
              <option value="created">Date created</option>
            </select>
            <button className="icon-button" aria-label="Toggle layout" onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>
              {layout === 'grid' ? '☷' : '▦'}
            </button>
            <button className={`text-button ${selecting ? 'active' : ''}`} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>
              {selecting ? 'Done' : 'Select'}
            </button>
          </>
        )}
        {route.view === 'library' && !query && (
          <>
            <button className="text-button" onClick={() => setDialog({ kind: 'new-folder' })}>
              + Folder
            </button>
            <button className="primary" onClick={() => setDialog({ kind: 'new-notebook' })}>
              + Notebook
            </button>
          </>
        )}
        {inTrash && library.trashed.length > 0 && (
          <button
            className="danger"
            onClick={() => {
              if (confirm('Permanently delete everything in the Trash? This cannot be undone.')) {
                void act(() => purgeItems(db, library.trashed.map((i) => i.id)));
              }
            }}
          >
            Empty Trash
          </button>
        )}
      </header>

      {selecting && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="link" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
            Select all
          </button>
          <button disabled={!selected.size} onClick={() => setDialog({ kind: 'move', ids: selectedIds })}>
            Move to…
          </button>
          <button disabled={!selected.size} onClick={() => void act(async () => { for (const id of selectedIds) await setFavorite(db, id, true); })}>
            ⭐ Favorite
          </button>
          <button
            className="danger"
            disabled={!selected.size}
            onClick={() => void act(() => trashItems(db, selectedIds)).then(() => setSelected(new Set()))}
          >
            Move to Trash
          </button>
        </div>
      )}

      {inTrash && <p className="hint">Items in the Trash are deleted permanently after 30 days.</p>}

      {items.length === 0 ? (
        <EmptyState route={route} searching={!!query} />
      ) : (
        <div className={layout === 'grid' ? 'grid' : 'list'}>
          {items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              library={library}
              layout={layout}
              showPath={!!query || route.view !== 'library'}
              selecting={selecting}
              selected={selected.has(item.id)}
              dropTarget={dropTarget === item.id}
              onOpen={() => (inTrash ? setMenuFor(item.id) : open(item))}
              onMenu={() => setMenuFor(item.id)}
              dragIds={selected.has(item.id) ? selectedIds : [item.id]}
              dropProps={item.kind === 'folder' && !inTrash ? dropOn(item.id, item.id) : undefined}
            />
          ))}
        </div>
      )}

      {menuFor && library.byId.get(menuFor) && (
        <ItemMenu
          item={library.byId.get(menuFor)!}
          inTrash={inTrash}
          onClose={() => setMenuFor(null)}
          onOpen={() => open(library.byId.get(menuFor)!)}
          onDialog={setDialog}
          onExportPdf={exportPdf}
        />
      )}

      {dialog?.kind === 'new-folder' && (
        <PromptDialog
          title="New Folder"
          initial="New Folder"
          confirmLabel="Create"
          onConfirm={(name) => void act(() => createFolder(db, name, folderId))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'new-notebook' && (
        <NewNotebookDialog
          onCreate={(name, template, color) =>
            void act(async () => onOpenNotebook((await createNotebook(db, name, folderId, template, color)).id))
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          initial={dialog.item.name}
          confirmLabel="Rename"
          onConfirm={(name) => void act(() => renameItem(db, dialog.item.id, name))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'tags' && dialog.item.kind === 'notebook' && (
        <PromptDialog
          title="Tags (comma separated)"
          initial={dialog.item.tags.join(', ')}
          confirmLabel="Save"
          onConfirm={(value) => void act(() => setTags(db, dialog.item.id, value.split(',')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'color' && (
        <Modal title="Color" onClose={() => setDialog(null)}>
          <ColorRow
            colors={dialog.item.kind === 'folder' ? FOLDER_COLORS : COVER_COLORS}
            value={dialog.item.kind === 'folder' ? dialog.item.color : dialog.item.coverColor}
            onChange={(c) => {
              void act(() => setColor(db, dialog.item.id, c));
              setDialog(null);
            }}
          />
        </Modal>
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          library={library}
          movingIds={dialog.ids}
          onMove={(target) => void act(() => moveItems(db, dialog.ids, target)).then(() => setSelected(new Set()))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Tile(props: {
  item: LibraryItem;
  library: LibraryState;
  layout: 'grid' | 'list';
  showPath: boolean;
  selecting: boolean;
  selected: boolean;
  dropTarget: boolean;
  dragIds: ID[];
  onOpen: () => void;
  onMenu: () => void;
  dropProps?: Record<string, unknown>;
}) {
  const { item } = props;
  const date = new Date(item.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const childCount =
    item.kind === 'folder' ? props.library.visible.filter((i) => i.parentId === item.id).length : 0;
  return (
    <div
      className={`tile ${props.layout} ${props.selected ? 'selected' : ''} ${props.dropTarget ? 'drop-target' : ''}`}
      draggable={!props.selecting}
      onDragStart={(e) => writeDragIds(e, props.dragIds)}
      {...props.dropProps}
    >
      <button className="tile-main" onClick={props.onOpen} aria-label={`Open ${item.name}`}>
        <div className="tile-art">
          {item.kind === 'folder' ? (
            <FolderGlyph color={item.color} size={props.layout === 'grid' ? 96 : 32} />
          ) : (
            <div className="cover" style={{ background: item.coverColor }}>
              <span className="cover-title">{item.name}</span>
            </div>
          )}
          {props.selecting && <span className={`check ${props.selected ? 'on' : ''}`}>{props.selected ? '✓' : ''}</span>}
          {item.favorite && <span className="fav">★</span>}
        </div>
        <div className="tile-text">
          <div className="tile-name">{item.name}</div>
          <div className="tile-sub">
            {props.showPath ? pathOf(props.library.byId, item) : item.kind === 'folder' ? `${childCount} item${childCount === 1 ? '' : 's'}` : date}
          </div>
        </div>
      </button>
      {!props.selecting && (
        <button className="tile-more" aria-label={`More actions for ${item.name}`} onClick={props.onMenu}>
          •••
        </button>
      )}
    </div>
  );
}

function ItemMenu(props: {
  item: LibraryItem;
  inTrash: boolean;
  onClose: () => void;
  onOpen: () => void;
  onDialog: (d: Dialog) => void;
  onExportPdf: (item: LibraryItem) => Promise<void>;
}) {
  const { item, onClose } = props;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="menu-list">
        {props.inTrash ? (
          <>
            <button onClick={run(() => void act(() => restoreItem(db, item.id)))}>Restore</button>
            <button
              className="danger-text"
              onClick={run(() => {
                if (confirm(`Permanently delete “${item.name}”? This cannot be undone.`)) void act(() => purgeItems(db, [item.id]));
              })}
            >
              Delete permanently
            </button>
          </>
        ) : (
          <>
            <button onClick={run(props.onOpen)}>Open</button>
            <button onClick={run(() => props.onDialog({ kind: 'rename', item }))}>Rename</button>
            <button onClick={run(() => void act(() => setFavorite(db, item.id, !item.favorite)))}>
              {item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
            <button onClick={run(() => props.onDialog({ kind: 'color', item }))}>Change color</button>
            {item.kind === 'notebook' && <button onClick={run(() => props.onDialog({ kind: 'tags', item }))}>Tags…</button>}
            <button onClick={run(() => props.onDialog({ kind: 'move', ids: [item.id] }))}>Move to…</button>
            {item.kind === 'notebook' && <button onClick={run(() => void props.onExportPdf(item))}>Export as PDF</button>}
            <button className="danger-text" onClick={run(() => void act(() => trashItems(db, [item.id])))}>
              Move to Trash
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function EmptyState({ route, searching }: { route: Route; searching: boolean }) {
  const text = searching
    ? 'Nothing matches your search.'
    : route.view === 'trash'
      ? 'Trash is empty.'
      : route.view === 'favorites'
        ? 'Tap ••• on a notebook or folder and choose “Add to Favorites”.'
        : route.view === 'recents'
          ? 'Notebooks you open will appear here.'
          : 'Create a folder or notebook to get started.';
  return <div className="empty">{text}</div>;
}
