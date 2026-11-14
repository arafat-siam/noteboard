import { useEffect, useMemo, useRef, useState } from 'react';
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
  setNotebookSettings,
  setTags,
  sortItems,
  trashItems,
  type SortKey,
} from '../db/library';
import { notebookPages } from '../db/pages';
import { exportNotebookPdf, safeFilename, shareOrDownload } from '../export/exporters';
import { COVER_COLORS, FOLDER_COLORS, type ID, type LibraryItem, type Notebook } from '../model/types';
import { ColorRow, Modal, MoveDialog, NewNotebookDialog, PromptDialog } from './Dialogs';
import { act, pathOf, useLibrary, type LibraryState } from './useLibrary';
import { importPdf } from '../pdf/pdf';
import { setLocalOnly } from '../sync/localOnly';
import { useSyncStatus } from '../sync/instance';
import { useLiveQuery } from 'dexie-react-hooks';
import { readDragIds, writeDragIds } from './dnd';
import { Icon, type IconName } from './Icon';
import { MenuButton, MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { NotebookLockDialog, UnlockNotebook } from './NotebookLockDialogs';
import { ShareDialog } from './ShareDialog';
import { PageThumbnail } from './PageManager';
import { isNotebookUnlocked } from '../security/notebookLock';

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
  | { kind: 'lock'; item: Notebook }
  | { kind: 'share'; item: LibraryItem }
  | { kind: 'unlock-export'; item: Notebook }
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
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Notebooks with pages not yet uploaded (shown only while Drive sync is connected).
  const syncState = useSyncStatus().state;
  const syncing = syncState !== 'signed-out' && syncState !== 'not-configured';
  const pendingNotebooks = useLiveQuery(
    async () => new Set((await db.pages.where('dirty').equals(1).toArray()).map((p) => p.notebookId)),
    [],
  ) ?? new Set<ID>();
  const [importing, setImporting] = useState(false);
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
    // A locked notebook can only be exported after its passcode is entered.
    if (!isNotebookUnlocked(item)) {
      setDialog({ kind: 'unlock-export', item });
      return;
    }
    const blob = await exportNotebookPdf(item, await notebookPages(db, item.id));
    await shareOrDownload(blob, `${safeFilename(item.name)}.pdf`);
  };

  const selectedIds = [...selected];

  const folders = items.filter((i) => i.kind === 'folder');
  const notebooks = items.filter((i) => i.kind === 'notebook');
  const showSections = !query && route.view === 'library' && folders.length > 0 && notebooks.length > 0;
  const recent =
    route.view === 'library' && !folderId && !query
      ? library.visible
          .filter((i): i is Extract<LibraryItem, { kind: 'notebook' }> => i.kind === 'notebook' && !!i.lastOpenedAt)
          .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
          .slice(0, 6)
      : [];

  const renderTiles = (list: LibraryItem[]) => (
    <div className={layout === 'grid' ? 'grid' : 'list'}>
      {list.map((item) => (
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
          pending={syncing && pendingNotebooks.has(item.id) && !library.localOnly.has(item.id)}
        />
      ))}
    </div>
  );

  return (
    <div className="library">
      <header className="toolbar library-toolbar">
        <button className="icon-button" aria-label="Show or hide the sidebar" onClick={onToggleSidebar}>
          <Icon name="menu" size={22} />
        </button>
        <div className="crumbs">
          {crumbs.length > 0 && (
            <div className="crumb-trail">
              <button
                className={`crumb ${dropTarget === 'crumb-root' ? 'drop-target' : ''}`}
                onClick={() => onNavigate({ view: 'library', folderId: null })}
                {...dropOn('crumb-root', null)}
              >
                All notebooks
              </button>
              {crumbs.slice(0, -1).map((f) => (
                <span key={f.id} className="crumb-part">
                  <Icon name="chevronRight" size={14} className="crumb-sep" />
                  <button
                    className={`crumb ${dropTarget === f.id ? 'drop-target' : ''}`}
                    onClick={() => onNavigate({ view: 'library', folderId: f.id })}
                    {...dropOn(f.id, f.id)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          <h1>{title}</h1>
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search" aria-label="Search notebooks, folders and tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {!inTrash && (
          <>
            <MenuButton
              className="header-icon"
              label="View and sort options"
              menu={(close) => (
                <>
                  <MenuLabel>View</MenuLabel>
                  <MenuItem icon="grid" label="Grid" checked={layout === 'grid'} onClick={() => { setLayout('grid'); close(); }} />
                  <MenuItem icon="list" label="List" checked={layout === 'list'} onClick={() => { setLayout('list'); close(); }} />
                  <MenuSeparator />
                  <MenuLabel>Sort by</MenuLabel>
                  <MenuItem label="Name" checked={sort === 'name'} onClick={() => { setSort('name'); close(); }} />
                  <MenuItem label="Last edited" checked={sort === 'updated'} onClick={() => { setSort('updated'); close(); }} />
                  <MenuItem label="Date created" checked={sort === 'created'} onClick={() => { setSort('created'); close(); }} />
                </>
              )}
            >
              <Icon name="sliders" size={20} />
            </MenuButton>
            <button
              className={`header-icon${selecting ? ' on' : ''}`}
              aria-label={selecting ? 'Finish selecting' : 'Select items'}
              title={selecting ? 'Done' : 'Select'}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
              }}
            >
              <Icon name={selecting ? 'close' : 'check'} size={20} />
            </button>
          </>
        )}
        {route.view === 'library' && !query && (
          <>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (!files.length) return;
                setImporting(true);
                void act(async () => {
                  let first: string | null = null;
                  for (const file of files) {
                    const notebook = await importPdf(db, file, folderId);
                    first ??= notebook.id;
                  }
                  // A single PDF opens straight away, ready to annotate.
                  if (files.length === 1 && first) onOpenNotebook(first);
                }).finally(() => setImporting(false));
              }}
            />
            <MenuButton
              className="round-add"
              label={importing ? 'Importing PDF' : 'Create or import'}
              menu={(close) => (
                <>
                  <MenuItem icon="notebook" label="New notebook" onClick={() => { close(); setDialog({ kind: 'new-notebook' }); }} />
                  <MenuItem icon="folderPlus" label="New folder" onClick={() => { close(); setDialog({ kind: 'new-folder' }); }} />
                  <MenuSeparator />
                  <MenuItem icon="fileImport" label="Import PDF" disabled={importing} onClick={() => { close(); pdfInputRef.current?.click(); }} />
                </>
              )}
            >
              {importing ? <Icon name="sync" size={22} className="spin" /> : <Icon name="plus" size={24} />}
            </MenuButton>
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
            <Icon name="folder" size={18} /> Move
          </button>
          <button disabled={!selected.size} onClick={() => void act(async () => { for (const id of selectedIds) await setFavorite(db, id, true); })}>
            <Icon name="star" size={18} /> Favorite
          </button>
          <button
            className="danger"
            disabled={!selected.size}
            onClick={() => void act(() => trashItems(db, selectedIds)).then(() => setSelected(new Set()))}
          >
            <Icon name="trash" size={18} /> Move to Trash
          </button>
        </div>
      )}

      {inTrash && <p className="hint">Items in the Trash are deleted permanently after 30 days.</p>}

      {recent.length > 0 && !selecting && (
        <section className="library-section recent-strip">
          <h2 className="section-title">Continue writing</h2>
          <div className="recent-row">
            {recent.map((nb) => (
              <button key={nb.id} className="recent-card" onClick={() => onOpenNotebook(nb.id)} aria-label={`Open ${nb.name}`}>
                {nb.lock || !nb.pageIds[0] ? (
                  <span className="mini-cover" style={{ ['--cover' as string]: nb.coverColor }} />
                ) : (
                  <span className="mini-thumb">
                    <PageThumbnail pageId={nb.pageIds[0]} width={36} fillHeight={46} />
                  </span>
                )}
                <span className="recent-text">
                  <span className="recent-name">{nb.name}</span>
                  <span className="recent-sub">{relativeTime(nb.lastOpenedAt ?? nb.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <EmptyState
          route={route}
          searching={!!query}
          onNewNotebook={() => setDialog({ kind: 'new-notebook' })}
          onNewFolder={() => setDialog({ kind: 'new-folder' })}
        />
      ) : showSections ? (
        <>
          <section className="library-section">
            <h2 className="section-title">Folders</h2>
            {renderTiles(folders)}
          </section>
          <section className="library-section">
            <h2 className="section-title">Notebooks</h2>
            {renderTiles(notebooks)}
          </section>
        </>
      ) : (
        <section className="library-section">{renderTiles(items)}</section>
      )}

      {menuFor && library.byId.get(menuFor) && (
        <ItemMenu
          item={library.byId.get(menuFor)!}
          inTrash={inTrash}
          onClose={() => setMenuFor(null)}
          onOpen={() => open(library.byId.get(menuFor)!)}
          onDialog={setDialog}
          onExportPdf={exportPdf}
          localOnly={library.localOnly.has(menuFor)}
          localOnlyRoot={library.localOnlyRoots.has(menuFor)}
        />
      )}

      {dialog?.kind === 'new-folder' && (
        <PromptDialog
          title="New folder"
          initial="New folder"
          confirmLabel="Create"
          onConfirm={(name) => void act(() => createFolder(db, name, folderId))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'new-notebook' && (
        <NewNotebookDialog
          onCreate={(name, template, color, size) =>
            void act(async () => {
              const nb = await createNotebook(db, name, folderId, template, color, size);
              await setNotebookSettings(db, nb.id, { pageSize: size });
              onOpenNotebook(nb.id);
            })
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
          title="Tags (separated by commas)"
          initial={dialog.item.tags.join(', ')}
          confirmLabel="Save"
          onConfirm={(value) => void act(() => setTags(db, dialog.item.id, value.split(',')))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'color' && (
        <Modal title="Colour" onClose={() => setDialog(null)}>
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
      {dialog?.kind === 'lock' && <NotebookLockDialog notebook={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'share' && <ShareDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'unlock-export' && (
        <UnlockNotebook
          notebook={dialog.item}
          onUnlocked={() => {
            const item = dialog.item;
            setDialog(null);
            void exportPdf(item);
          }}
          onCancel={() => setDialog(null)}
        />
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
  /** Has changes not yet uploaded to Google Drive. */
  pending?: boolean;
}) {
  const { item } = props;
  const updated = new Date(item.updatedAt);
  // "14 Nov" this year, "14 Nov 2025" before: short enough not to wrap under the card.
  const date = updated.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(updated.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
  const childCount =
    item.kind === 'folder' ? props.library.visible.filter((i) => i.parentId === item.id).length : 0;

  // Press and hold a notebook or folder to open its menu (right-click on a computer).
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const pressProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (props.selecting || (e.pointerType === 'mouse' && e.button !== 0)) return;
      longPressed.current = false;
      cancelPress();
      press.current = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          press.current = null;
          longPressed.current = true;
          navigator.vibrate?.(10);
          props.onMenu();
        }, 450),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!props.selecting && !longPressed.current) props.onMenu();
    },
  };
  useEffect(() => cancelPress, []);

  return (
    <div
      className={`tile ${props.layout} ${props.selected ? 'selected' : ''} ${props.dropTarget ? 'drop-target' : ''}`}
      draggable={!props.selecting}
      onDragStart={(e) => {
        cancelPress();
        writeDragIds(e, props.dragIds);
      }}
      {...props.dropProps}
      {...pressProps}
    >
      <button
        className="tile-main"
        onClick={() => {
          // The long press already opened the menu: don't also open the notebook.
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          props.onOpen();
        }}
        aria-label={`Open ${item.name}`}
      >
        <div className="tile-art">
          {item.kind === 'folder' ? (
            <div className="folder-art" style={{ ['--folder' as string]: item.color }}>
              <span className="folder-back" />
              <span className="folder-paper" />
              <span className="folder-front" />
            </div>
          ) : (
            <NotebookCover notebook={item} size={props.layout === 'grid' ? 132 : 34} />
          )}
          {props.selecting && (
            <span className={`check ${props.selected ? 'on' : ''}`}>{props.selected && <Icon name="check" size={14} />}</span>
          )}
          {item.favorite && (
            <span className="fav" aria-label="Favorite">
              <Icon name="star" size={14} filled />
            </span>
          )}
        </div>
        <div className="tile-text">
          <div className="tile-name">
            {item.kind === 'notebook' && item.lock && (
              <span className="local-badge" title="Locked with a passcode" aria-label="Locked">
                <Icon name="lock" size={14} />
              </span>
            )}
            {props.library.localOnly.has(item.id) && (
              <span className="local-badge" title="Kept on this iPad only, not synced" aria-label="Not synced">
                <Icon name="tablet" size={14} />
              </span>
            )}
            {item.name}
          </div>
          <div className="tile-sub">
            {props.pending && (
              <span className="pending-badge" title="Not yet uploaded to Google Drive" aria-label="Not yet uploaded">
                <Icon name="upload" size={13} />
              </span>
            )}
            {props.showPath
              ? pathOf(props.library.byId, item)
              : item.kind === 'folder'
                ? `${childCount} item${childCount === 1 ? '' : 's'}`
                : `${item.pageIds.length} page${item.pageIds.length === 1 ? '' : 's'} · ${date}`}
          </div>
        </div>
      </button>
      {!props.selecting && (
        <button className="tile-more" aria-label={`More actions for ${item.name}`} onClick={props.onMenu}>
          <Icon name="more" size={20} />
        </button>
      )}
    </div>
  );
}

/**
 * A notebook shown as its first page (like Drawboard), with its colour as a thin band on top.
 * Locked notebooks never show their content here.
 */
function NotebookCover({ notebook, size }: { notebook: Notebook; size: number }) {
  const first = notebook.pageIds[0];
  // Every card has the same shape: a long or wide page shows its top part, not its whole length.
  const height = Math.round(size * 1.3);
  return (
    <div className="doc-cover" style={{ ['--cover' as string]: notebook.coverColor, width: size, height }}>
      {notebook.lock ? (
        <div className="doc-locked" style={{ height }}>
          <Icon name="lock" size={size > 60 ? 28 : 14} />
        </div>
      ) : first ? (
        <PageThumbnail pageId={first} width={size} fillHeight={height} />
      ) : (
        <div className="doc-locked" style={{ height }} />
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
  /** Kept on this iPad only (itself or via a folder it's in). */
  localOnly: boolean;
  /** Marked itself (so it can be switched back here). */
  localOnlyRoot: boolean;
}) {
  const { item, onClose } = props;
  const what = item.kind === 'folder' ? 'this folder and everything in it' : 'this notebook';
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="item-menu">
        {props.inTrash ? (
          <>
            <MenuItem icon="undo" label="Restore" onClick={run(() => void act(() => restoreItem(db, item.id)))} />
            <MenuItem
              icon="trash"
              label="Delete permanently"
              danger
              onClick={run(() => {
                if (confirm(`Permanently delete “${item.name}”? This cannot be undone.`)) void act(() => purgeItems(db, [item.id]));
              })}
            />
          </>
        ) : (
          <>
            <MenuItem icon={item.kind === 'folder' ? 'folder' : 'notebook'} label="Open" onClick={run(props.onOpen)} />
            <MenuItem icon="edit" label="Rename" onClick={run(() => props.onDialog({ kind: 'rename', item }))} />
            <MenuItem
              icon="star"
              label={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
              onClick={run(() => void act(() => setFavorite(db, item.id, !item.favorite)))}
            />
            <MenuItem icon="palette" label="Change colour" onClick={run(() => props.onDialog({ kind: 'color', item }))} />
            {item.kind === 'notebook' && <MenuItem icon="tag" label="Tags" onClick={run(() => props.onDialog({ kind: 'tags', item }))} />}
            <MenuItem icon="move" label="Move to folder" onClick={run(() => props.onDialog({ kind: 'move', ids: [item.id] }))} />
            <MenuSeparator />
            {item.kind === 'notebook' && <MenuItem icon="download" label="Export as PDF" onClick={run(() => void props.onExportPdf(item))} />}
            <MenuItem icon="link" label="Share view-only link" onClick={run(() => props.onDialog({ kind: 'share', item }))} />
            {item.kind === 'notebook' && (
              <MenuItem icon="lock" label={item.lock ? 'Passcode settings' : 'Lock with passcode'} onClick={run(() => props.onDialog({ kind: 'lock', item }))} />
            )}
            {props.localOnlyRoot ? (
              <MenuItem
                icon="cloud"
                label="Sync with Google Drive again"
                onClick={run(() => {
                  if (confirm(`Sync “${item.name}” with Google Drive again?`)) void act(() => setLocalOnly(db, item.id, false));
                })}
              />
            ) : props.localOnly ? (
              <MenuItem icon="tablet" label="On this iPad only (set on its folder)" disabled onClick={() => undefined} />
            ) : (
              <MenuItem
                icon="tablet"
                label="Keep on this iPad only"
                onClick={run(() => {
                  const ok = confirm(
                    `Keep ${what} on this iPad only?

- It will not be uploaded to Google Drive, and any existing copy there will be removed.
- It will not appear on your other devices.
- If this iPad is lost or reset, these notes cannot be recovered. Export a PDF or backup to keep a copy.`,
                  );
                  if (ok) void act(() => setLocalOnly(db, item.id, true));
                })}
              />
            )}
            <MenuSeparator />
            <MenuItem icon="trash" label="Move to Trash" danger onClick={run(() => void act(() => trashItems(db, [item.id])))} />
          </>
        )}
      </div>
    </Modal>
  );
}

function relativeTime(time: number): string {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function EmptyState(props: { route: Route; searching: boolean; onNewNotebook: () => void; onNewFolder: () => void }) {
  const { route, searching } = props;
  const [icon, title, text]: [IconName, string, string] = searching
    ? ['search', 'No results', 'Nothing matches your search. Try a different word or tag.']
    : route.view === 'trash'
      ? ['trash', 'Trash is empty', 'Deleted notebooks and folders stay here for 30 days.']
      : route.view === 'favorites'
        ? ['star', 'No favorites yet', 'Open the menu on a notebook or folder and choose Add to Favorites.']
        : route.view === 'recents'
          ? ['clock', 'Nothing opened yet', 'Notebooks you open will appear here.']
          : route.view === 'tag'
            ? ['tag', 'No notebooks with this tag', 'Add tags from a notebook’s menu.']
            : ['notebook', 'Start writing', 'Create a notebook for handwritten notes, or a folder to keep things organised. You can also import a PDF to write on.'];
  const canCreate = route.view === 'library' && !searching;
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {canCreate && (
        <div className="empty-actions">
          <button className="primary" onClick={props.onNewNotebook}>
            <Icon name="plus" size={18} /> New notebook
          </button>
          <button onClick={props.onNewFolder}>
            <Icon name="folderPlus" size={18} /> New folder
          </button>
        </div>
      )}
    </div>
  );
}
