import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useEffect } from 'react';
import { db } from '../db/db';
import { InkPage, type ToolSettings } from '../ink/InkPage';
import { PAGE_HEIGHT, PAGE_WIDTH, type Page, type Stroke } from '../model/types';

interface Props {
  pageId: string;
  index: number;
  total: number;
  scale: number;
  settings: ToolSettings;
  scroller: HTMLElement | null;
  onChange: (pageId: string, added: Stroke[], removedIds: string[]) => void;
  onHoverHold: (clientX: number, clientY: number) => void;
  onRequestSelect: () => void;
  onPageMenu: (page: Page) => void;
  /** Latest copy of every loaded page, for undo (which needs the strokes being erased). */
  registry: Map<string, Page>;
}

/**
 * One page of the editor. It watches only its own page in the database, so writing on a page
 * (or sync updating one) re-reads that page alone — never the whole notebook. Re-reading the
 * whole notebook on every change froze the app for a moment on large notebooks, which showed
 * up as lag and a stuttering, "doubled" hover pointer.
 */
export const PageSlot = memo(function PageSlot(props: Props) {
  const { pageId, registry } = props;
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId]);

  useEffect(() => {
    if (page) registry.set(pageId, page);
  }, [page, pageId, registry]);
  useEffect(() => () => void registry.delete(pageId), [pageId, registry]);

  if (!page) {
    // Still loading (or not downloaded yet): keep the page's space so scrolling doesn't jump.
    return (
      <div className="page-slot">
        <div className="page-placeholder" style={{ width: PAGE_WIDTH * props.scale, height: PAGE_HEIGHT * props.scale }} />
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
        onChange={props.onChange}
        onHoverHold={props.onHoverHold}
        onRequestSelect={props.onRequestSelect}
      />
      <div className="page-footer">
        <span>
          Page {props.index + 1} of {props.total}
        </span>
        <button className="link" onClick={() => props.onPageMenu(page)}>
          Page options
        </button>
      </div>
    </div>
  );
});
