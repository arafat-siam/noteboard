import { useEffect, useState } from 'react';
import { DARK_PAPER, PAPER_COLORS, TEMPLATE_LABELS, templateStyle } from '../ink/templates';
import { dimsFor, orientationOf, PAGE_SIZE_ORDER, PAGE_SIZES, sizeIdOf, type PageDims } from '../model/pageSizes';
import { COVER_COLORS, type PaperTemplate } from '../model/types';
import { Icon } from './Icon';

export interface NewNotebookOptions {
  name: string;
  template: PaperTemplate;
  coverColor: string;
  size: PageDims;
  cover: boolean;
  /** Paper colour (hex); ignored when `night`. */
  paper: string;
  /** Night mode pages (dark paper, ink shown light). */
  night: boolean;
}

const NIGHT = 'night';
/** Width of the preview page, in CSS pixels (its height follows the paper size). */
const PREVIEW = 128;

/**
 * New notebook: a live preview (cover in front of the first page) and one list of settings:
 * name, cover, cover colour, paper, page colour, size and orientation.
 */
export function NewNotebookDialog(props: { onCreate: (options: NewNotebookOptions) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [cover, setCover] = useState(true);
  const [coverColor, setCoverColor] = useState(COVER_COLORS[COVER_COLORS.length - 1] ?? '#202124');
  const [template, setTemplate] = useState<PaperTemplate>('ruled');
  const [paper, setPaper] = useState<string>(PAPER_COLORS[0]!.value);
  const [size, setSize] = useState<PageDims>(() => dimsFor('a4', 'portrait'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const orientation = orientationOf(size);
  const sizeId = sizeIdOf(size);
  const night = paper === NIGHT;
  const title = name.trim() || 'Untitled notebook';

  const create = () => {
    props.onCreate({ name: title, template, coverColor, size, cover, paper: night ? PAPER_COLORS[0]!.value : paper, night });
    props.onClose();
  };

  // Preview: the page scaled to a fixed width (landscape pages are capped by height instead).
  const k = Math.min(PREVIEW / Math.min(size.width, size.height), (PREVIEW * 1.45) / Math.max(size.width, size.height));
  const w = size.width * k;
  const h = size.height * k;
  const pageLook = templateStyle(template, k, night, size, night ? undefined : paper);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal nb-create" role="dialog" aria-label="New notebook" onClick={(e) => e.stopPropagation()}>
        <div className="nb-create-head">
          <h2>New notebook</h2>
          <button className="header-icon" aria-label="Close" onClick={props.onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="nb-create-body">
          <div className="nb-preview" aria-hidden="true">
            <div className="nb-preview-stack" style={{ width: w + (cover ? 16 : 0), height: h + (cover ? 12 : 0) }}>
              <div className="nb-preview-page" style={{ width: w, height: h, left: cover ? 16 : 0, top: 0, ...pageLook }} />
              {cover && (
                <div className="nb-preview-cover" style={{ width: w, height: h, background: coverColor }}>
                  <span>{title}</span>
                </div>
              )}
            </div>
          </div>
          <div className="nb-settings">
            <label className="nb-row">
              <span className="nb-key">Name</span>
              <input
                className="text-input nb-name"
                value={name}
                placeholder="Untitled notebook"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
            </label>
            <div className="nb-row">
              <span className="nb-key">Cover</span>
              <div className="segmented nb-seg">
                <button className={cover ? 'on' : ''} onClick={() => setCover(true)}>
                  Cover
                </button>
                <button className={!cover ? 'on' : ''} onClick={() => setCover(false)}>
                  None
                </button>
              </div>
            </div>
            <div className={`nb-row${cover ? '' : ' nb-off'}`}>
              <span className="nb-key">Cover colour</span>
              <div className="nb-swatches" role="radiogroup" aria-label="Cover colour">
                {COVER_COLORS.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={c === coverColor}
                    aria-label={`Cover colour ${c}`}
                    className={`nb-swatch${c === coverColor ? ' on' : ''}`}
                    style={{ background: c }}
                    disabled={!cover}
                    onClick={() => setCoverColor(c)}
                  />
                ))}
              </div>
            </div>
            <label className="nb-row">
              <span className="nb-key">Paper</span>
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value as PaperTemplate)}>
                {(Object.keys(TEMPLATE_LABELS) as PaperTemplate[]).map((t) => (
                  <option key={t} value={t}>
                    {TEMPLATE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <div className="nb-row">
              <span className="nb-key">Page colour</span>
              <div className="nb-swatches" role="radiogroup" aria-label="Page colour">
                {[...PAPER_COLORS, { name: 'Night', value: NIGHT }].map((p) => (
                  <button
                    key={p.value}
                    role="radio"
                    aria-checked={p.value === paper}
                    aria-label={p.name}
                    title={p.name}
                    className={`nb-swatch paper${p.value === paper ? ' on' : ''}`}
                    style={{ background: p.value === NIGHT ? DARK_PAPER.paper : p.value }}
                    onClick={() => setPaper(p.value)}
                  />
                ))}
              </div>
            </div>
            <label className="nb-row">
              <span className="nb-key">Size</span>
              <select
                className="select"
                value={sizeId}
                onChange={(e) => setSize(dimsFor(e.target.value as keyof typeof PAGE_SIZES, orientation))}
              >
                {sizeId === 'custom' && <option value="custom">Custom</option>}
                {PAGE_SIZE_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {PAGE_SIZES[id].label} · {PAGE_SIZES[id].detail}
                  </option>
                ))}
              </select>
            </label>
            <div className="nb-row">
              <span className="nb-key">Orientation</span>
              <div className="segmented nb-seg">
                <button
                  className={orientation === 'portrait' ? 'on' : ''}
                  onClick={() => orientation !== 'portrait' && setSize({ width: size.height, height: size.width })}
                >
                  <span className="nb-ori portrait" /> Portrait
                </button>
                <button
                  className={orientation === 'landscape' ? 'on' : ''}
                  onClick={() => orientation !== 'landscape' && setSize({ width: size.height, height: size.width })}
                >
                  <span className="nb-ori landscape" /> Landscape
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="nb-create-foot">
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
