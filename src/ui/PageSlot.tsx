import { liveQuery } from 'dexie';
import { memo, useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { applyEdit, loadPage, onLocalEdit } from '../db/pages';
import { InkPage, type ToolSettings } from '../ink/InkPage';
import { PAGE_HEIGHT, PAGE_WIDTH, type Page, type Stroke } from '../model/types';

interface Props {
  pageId: string;
  index: number;
  total: number;
  scale: number;
  settings: ToolSettings;
  /** Night mode: dark paper, light ink. */
  dark: boolean;
  /** In night mode, invert imported PDF pages too. */
  invertPdf: boolean;
  scroller: HTMLElement | null;
  onChange: (pageId: string, added: Stroke[], removedIds: string[]) => void;
  onHoverHold: (clientX: number, clientY: number) => void;
  onRequestSelect: () => void;
  onPageMenu: (page: Page) => void;
  /** Latest copy of every loaded page, for undo (which needs the strokes being erased). */
  registry: Map<string, Page>;
  /** The page's size, known before its ink loads (keeps scrolling steady). */
  size?: { width: number; height: number };
}

/**
 * One page of the editor.
 *
 * Writing on the page updates it in memory (via `onLocalEdit`), so finishing a line costs
 * almost nothing no matter how full the page is. The page only re-reads its ink from the
 * database when something else changed it: sync from another device, a template change, etc.
 * (Re-reading every stroke after each line froze the app briefly on full pages, which showed
 * up as lag and a stuttering, "doubled" hover pointer.)
 */
export const PageSlot = memo(function PageSlot(props: Props) {
  const { pageId, registry } = props;
  const [page, setPage] = useState<Page | undefined>(undefined);
  /** The page as currently shown, read outside React to decide whether a re-read is needed. */
  const shownRef = useRef<Page | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let again = false;
    const show = (next: Page | undefined) => {
      if (cancelled) return;
      shownRef.current = next;
      setPage(next);
    };
    const reload = async () => {
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      try {
        do {
          again = false;
          show(await loadPage(db, pageId));
        } while (again && !cancelled);
      } finally {
        loading = false;
      }
    };

    // Own edits: applied in memory. They're announced before being saved, so this always
    // runs before the database change below arrives.
    const stopEdits = onLocalEdit((edit) => {
      if (edit.db !== db || edit.pageId !== pageId) return;
      const shown = shownRef.current;
      if (edit.failed || !shown || loading) void reload();
      else show(applyEdit(shown, edit));
    });

    // Changes to the small page record (it holds no ink): re-read the ink only if the change
    // isn't an edit already shown.
    const sub = liveQuery(() => db.pages.get(pageId)).subscribe({
      next: (record) => {
        const shown = shownRef.current;
        if (!record) show(undefined);
        else if (!shown || shown.updatedAt !== record.updatedAt || shown.template !== record.template) void reload();
        else if (shown.dirty !== record.dirty) show({ ...shown, dirty: record.dirty });
      },
      error: () => void reload(),
    });

    return () => {
      cancelled = true;
      stopEdits();
      sub.unsubscribe();
    };
  }, [pageId]);

  useEffect(() => {
    if (page) registry.set(pageId, page);
  }, [page, pageId, registry]);
  useEffect(() => () => void registry.delete(pageId), [pageId, registry]);

  if (!page) {
    // Still loading (or not downloaded yet): keep the page's space so scrolling doesn't jump.
    return (
      <div className="page-slot">
        <div className="page-placeholder" style={{ width: (props.size?.width ?? PAGE_WIDTH) * props.scale, height: (props.size?.height ?? PAGE_HEIGHT) * props.scale }} />
      </div>
    );
  }

  return (
    <div className="page-slot">
      <InkPage
        page={page}
        scale={props.scale}
        settings={props.settings}
        scroller={props.scroller}
        dark={props.dark}
        invertPdf={props.invertPdf}
        onChange={props.onChange}
        onHoverHold={props.onHoverHold}
        onRequestSelect={props.onRequestSelect}
      />
      {props.scale < 0.3 ? (
        // Zoomed far out: just the page number (tap it for the page options).
        <button className="page-number-mini" onClick={() => props.onPageMenu(page)}>
          {props.index + 1}
        </button>
      ) : (
        <div className="page-footer">
          <span>
            Page {props.index + 1} of {props.total}
          </span>
          <button className="link" onClick={() => props.onPageMenu(page)}>
            Page options
          </button>
        </div>
      )}
    </div>
  );
});
