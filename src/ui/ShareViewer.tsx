import { useEffect, useMemo, useRef, useState } from 'react';
import { GOOGLE_API_KEY } from '../config';
import { onImageLoaded, provideImage } from '../ink/images';
import { drawPage } from '../ink/render';
import { templateStyle } from '../ink/templates';
import type { Page } from '../model/types';
import { loadPdfJs, renderPdfRegion } from '../pdf/pdf';
import { unseal, WrongPasscodeError } from '../share/seal';
import { openLocked, readManifest, type NotebookContent, type ShareManifest, type SharedNotebook } from '../share/share';
import { downloadPublic } from '../sync/drive';
import { Icon } from './Icon';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const LOGO = `${import.meta.env.BASE_URL}icon.svg`;

/** Downloads (and decrypts) the files a shared notebook uses, once each. */
function useAssets(content: NotebookContent | null, passcode: string | null) {
  return useMemo(() => {
    const bytes = new Map<string, Promise<Uint8Array | null>>();
    const pdfs = new Map<string, Promise<PDFDocumentProxy | null>>();
    const get = (fileId: string) => {
      let found = bytes.get(fileId);
      if (!found) {
        const asset = content?.assets[fileId];
        found = asset
          ? downloadPublic(asset.driveId, GOOGLE_API_KEY)
              .then((data) => (passcode ? unseal(data, passcode) : data))
              .catch(() => null)
          : Promise.resolve(null);
        bytes.set(fileId, found);
      }
      return found;
    };
    return {
      image: async (fileId: string) => {
        const data = await get(fileId);
        if (data) await provideImage(fileId, new Blob([data], { type: content?.assets[fileId]?.mime }));
      },
      pdf: (fileId: string) => {
        let doc = pdfs.get(fileId);
        if (!doc) {
          doc = get(fileId).then(async (data) => (data ? (await loadPdfJs()).getDocument({ data }).promise : null)).catch(() => null);
          pdfs.set(fileId, doc);
        }
        return doc;
      },
    };
  }, [content, passcode]);
}

/** One read-only page, drawn when it comes near the screen. */
function ViewerPage({ page, scale, assets }: { page: Page; scale: number; assets: ReturnType<typeof useAssets> }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => onImageLoaded(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!visible) return;
    for (const s of page.strokes) if (s.image) void assets.image(s.image.fileId);
  }, [visible, page, assets]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!visible) {
      c.width = c.height = 0; // free memory far from the screen
      return;
    }
    let cancelled = false;
    void (async () => {
      const k = Math.min(scale * (window.devicePixelRatio || 1), Math.sqrt(8_000_000 / (page.width * page.height)));
      const w = Math.round(page.width * k);
      const h = Math.round(page.height * k);
      const region = { x: 0, y: 0, width: page.width, height: page.height, k };
      const ink = document.createElement('canvas');
      ink.width = w;
      ink.height = h;
      drawPage(ink.getContext('2d')!, page.strokes, region);
      let pdfLayer: HTMLCanvasElement | null = null;
      if (page.background) {
        const doc = await assets.pdf(page.background.fileId);
        if (doc && !cancelled) {
          const { canvas: rendered, task } = await renderPdfRegion(doc, page.background.pageIndex, region, w, h);
          await task.promise.catch(() => undefined);
          pdfLayer = rendered;
        }
      }
      if (cancelled) return;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      if (pdfLayer) ctx.drawImage(pdfLayer, 0, 0);
      ctx.drawImage(ink, 0, 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, page, scale, assets, tick]);
  return (
    <div
      ref={holder}
      className="viewer-page"
      style={{ width: page.width * scale, height: page.height * scale, ...(page.background ? { background: '#fff' } : templateStyle(page.template, scale, false, page)) }}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

function NotebookView({ entry, content, passcode, onBack }: { entry: SharedNotebook; content: NotebookContent; passcode: string | null; onBack?: () => void }) {
  const assets = useAssets(content, passcode);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const widest = Math.max(...content.pages.map((p) => p.width), 1);
  // Leave room for the page margins and a scroll bar.
  const scale = Math.min((width - 52) / widest, 1.6) * zoom;
  return (
    <div className="viewer">
      <header className="viewer-bar">
        {onBack ? (
          <button className="back-button" onClick={onBack}>
            <Icon name="chevronLeft" size={22} />
            <span>All notebooks</span>
          </button>
        ) : (
          <img src={LOGO} alt="" width={28} height={28} className="viewer-logo" />
        )}
        <div className="viewer-title">
          <strong>{entry.name}</strong>
          <span className="muted">
            {content.pages.length} page{content.pages.length === 1 ? '' : 's'} · view only
          </span>
        </div>
        <div className="zoom-controls">
          <button className="tool" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
            <Icon name="minus" size={18} />
          </button>
          <button className="tool text" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
            <Icon name="plus" size={18} />
          </button>
        </div>
      </header>
      <div className="viewer-pages">
        {content.pages.map((p) => (
          <ViewerPage key={p.id} page={p} scale={scale} assets={assets} />
        ))}
        <p className="viewer-foot">
          Shared with <a href={import.meta.env.BASE_URL}>Noteboard</a>
        </p>
      </div>
    </div>
  );
}

function LockedView({ entry, onOpen }: { entry: SharedNotebook & { locked: true }; onOpen: (content: NotebookContent, passcode: string) => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      onOpen(await openLocked(entry, passcode), passcode);
    } catch (e) {
      setError(e instanceof WrongPasscodeError ? 'Wrong passcode.' : 'This notebook could not be opened.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="notebook-locked">
      <div className="notebook-locked-card">
        <div className="lock-icon">
          <Icon name="lock" size={34} />
        </div>
        <h1>{entry.name}</h1>
        <p className="lock-hint">This shared notebook is locked. Enter its passcode to read it.</p>
        <input
          className="text-input"
          type="password"
          autoFocus
          autoComplete="off"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void open()}
          aria-label="Passcode"
        />
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy || !passcode} onClick={() => void open()}>
          {busy ? 'Opening' : 'Open'}
        </button>
      </div>
    </div>
  );
}

/** Opens a shared link (#/s/<id>): no account and no sign-in needed. */
export function ShareViewer({ fileId }: { fileId: string }) {
  const [manifest, setManifest] = useState<ShareManifest | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, { content: NotebookContent; passcode: string | null }>>({});

  useEffect(() => {
    if (!GOOGLE_API_KEY) {
      setError('Shared links are not set up on this website yet.');
      return;
    }
    downloadPublic(fileId, GOOGLE_API_KEY)
      .then(readManifest)
      .then((m) => {
        setManifest(m);
        document.title = `${m.name} · Noteboard`;
        if (m.kind === 'notebook' && m.notebooks[0]) setOpenId(m.notebooks[0].id);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'This link could not be opened.'));
  }, [fileId]);

  if (error)
    return (
      <div className="empty-state viewer-message">
        <div className="empty-icon">
          <Icon name="link" size={34} />
        </div>
        <h2>Can't open this link</h2>
        <p>{error}</p>
      </div>
    );
  if (!manifest) return <div className="loading">Opening shared notes</div>;

  const entry = manifest.notebooks.find((n) => n.id === openId);
  const back = manifest.kind === 'folder' ? () => setOpenId(null) : undefined;
  if (entry) {
    const content = entry.locked ? opened[entry.id] : { content: entry.content, passcode: null };
    if (!content && entry.locked)
      return <LockedView entry={entry} onOpen={(c, passcode) => setOpened({ ...opened, [entry.id]: { content: c, passcode } })} />;
    if (content) return <NotebookView entry={entry} content={content.content} passcode={content.passcode} onBack={back} />;
  }

  const groups = new Map<string, SharedNotebook[]>();
  for (const n of manifest.notebooks) groups.set(n.path, [...(groups.get(n.path) ?? []), n]);
  return (
    <div className="viewer">
      <header className="viewer-bar">
        <img src={LOGO} alt="" width={28} height={28} className="viewer-logo" />
        <div className="viewer-title">
          <strong>{manifest.name}</strong>
          <span className="muted">Shared folder · view only</span>
        </div>
      </header>
      <div className="viewer-list">
        {!manifest.notebooks.length && <p className="muted">This folder is empty.</p>}
        {[...groups.entries()].map(([path, list]) => (
          <section key={path} className="library-section">
            {path && <h2 className="section-title">{path}</h2>}
            <div className="grid">
              {list.map((n) => (
                <button key={n.id} className="viewer-tile" onClick={() => setOpenId(n.id)}>
                  <span className="cover" style={{ ['--cover' as string]: n.coverColor }}>
                    <span className="cover-label">
                      <span className="cover-title">{n.name}</span>
                    </span>
                  </span>
                  <span className="tile-name">
                    {n.locked && <Icon name="lock" size={14} />} {n.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
