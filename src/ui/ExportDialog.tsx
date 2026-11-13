import { useState } from 'react';
import { db } from '../db/db';
import { loadPages } from '../db/pages';
import { exportNotebookPdf, exportPagePng, safeFilename, shareOrDownload, shareOrDownloadAll } from '../export/exporters';
import { describePages, parsePageRange } from '../export/pageRange';
import type { ID, Notebook, Page } from '../model/types';
import { Icon } from './Icon';
import { Modal } from './Dialogs';

type Which = 'all' | 'current' | 'range' | 'picked';

/**
 * Export the whole notebook, the page on screen, or chosen pages, as one PDF or as pictures.
 * Pages can be typed ("1-3, 6") or picked visually in the page manager.
 */
export function ExportDialog(props: {
  notebook: Notebook;
  pageIds: ID[];
  /** Index of the page on screen. */
  currentIndex: number;
  /** Pages picked in the page manager (if the dialog was opened from there). */
  picked?: ID[];
  onPickPages: () => void;
  onClose: () => void;
}) {
  const { notebook, pageIds } = props;
  const [which, setWhich] = useState<Which>(props.picked?.length ? 'picked' : 'all');
  const [range, setRange] = useState(`${props.currentIndex + 1}`);
  const [format, setFormat] = useState<'pdf' | 'png'>('pdf');
  const [dark, setDark] = useState(notebook.pageTheme === 'dark');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const indexes = (): number[] | null => {
    switch (which) {
      case 'all':
        return pageIds.map((_, i) => i);
      case 'current':
        return [props.currentIndex];
      case 'range':
        return parsePageRange(range, pageIds.length);
      case 'picked':
        return (props.picked ?? []).map((id) => pageIds.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
    }
  };
  const chosen = indexes();
  const count = chosen?.length ?? 0;

  const run = async () => {
    const list = indexes();
    if (!list?.length) {
      setError('Choose at least one page, for example 1-3, 5.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pages = (await loadPages(db, list.map((i) => pageIds[i]!))).filter((p): p is Page => !!p);
      const base = safeFilename(notebook.name);
      const suffix = which === 'all' ? '' : ` ${describePages(list)}`;
      if (format === 'pdf') {
        await shareOrDownload(await exportNotebookPdf(notebook, pages, undefined, { dark }), `${base}${suffix}.pdf`);
      } else {
        const files = [];
        for (const [n, page] of pages.entries()) files.push({ blob: await exportPagePng(page, 2, undefined, dark), name: `${base} p${list[n]! + 1}.png` });
        await shareOrDownloadAll(files);
      }
      props.onClose();
    } catch {
      setError('Export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const option = (value: Which, label: string, detail?: string) => (
    <button className={`choice ${which === value ? 'on' : ''}`} role="radio" aria-checked={which === value} onClick={() => setWhich(value)}>
      <span className="choice-dot" />
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
    </button>
  );

  return (
    <Modal title="Export" onClose={props.onClose}>
      <div className="export-dialog">
        <div className="field-label">Pages</div>
        <div className="choices" role="radiogroup" aria-label="Pages to export">
          {option('all', 'All pages', `${pageIds.length} page${pageIds.length === 1 ? '' : 's'}`)}
          {option('current', 'Current page', `Page ${props.currentIndex + 1}`)}
          {option('range', 'Page range')}
          {which === 'range' && (
            <input
              className="range-input"
              value={range}
              autoFocus
              inputMode="numeric"
              placeholder="e.g. 1-3, 5"
              aria-label="Pages, for example 1-3, 5"
              onChange={(e) => setRange(e.target.value)}
            />
          )}
          {!!props.picked?.length && option('picked', 'Selected pages', `${props.picked.length} chosen in Pages`)}
        </div>
        <button className="link pick-link" onClick={props.onPickPages}>
          <Icon name="pages" size={18} /> Choose pages from thumbnails
        </button>

        <div className="field-label">Format</div>
        <div className="segmented">
          <button className={format === 'pdf' ? 'on' : ''} onClick={() => setFormat('pdf')}>
            PDF document
          </button>
          <button className={format === 'png' ? 'on' : ''} onClick={() => setFormat('png')}>
            Images (PNG)
          </button>
        </div>
        <div className="field-label">Pages look</div>
        <div className="segmented">
          <button className={!dark ? 'on' : ''} onClick={() => setDark(false)}>
            Light
          </button>
          <button className={dark ? 'on' : ''} onClick={() => setDark(true)}>
            Night (dark pages)
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={busy || !count} onClick={() => void run()}>
            {busy ? 'Exporting' : `Export ${count || ''} page${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
