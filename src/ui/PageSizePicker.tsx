import { useState } from 'react';
import {
  customDims,
  dimsFor,
  MM_PER_UNIT,
  orientationOf,
  PAGE_SIZE_ORDER,
  PAGE_SIZES,
  sizeIdOf,
  type Orientation,
  type PageDims,
} from '../model/pageSizes';
import { Modal } from './Dialogs';

/** Paper size presets (A4, A3, Letter…), portrait / landscape, or a custom size in mm. */
export function PageSizePicker({ value, onChange }: { value: PageDims; onChange: (d: PageDims) => void }) {
  const id = sizeIdOf(value);
  const orientation = orientationOf(value);
  const [custom, setCustom] = useState(id === 'custom');
  const [mm, setMm] = useState(() => ({ w: Math.round(value.width * MM_PER_UNIT), h: Math.round(value.height * MM_PER_UNIT) }));

  const choose = (next: PageDims) => {
    setMm({ w: Math.round(next.width * MM_PER_UNIT), h: Math.round(next.height * MM_PER_UNIT) });
    onChange(next);
  };
  const flip = (o: Orientation) => {
    if (o === orientation) return;
    choose({ width: value.height, height: value.width });
  };

  return (
    <div className="size-picker">
      <div className="size-grid" role="radiogroup" aria-label="Paper size">
        {PAGE_SIZE_ORDER.map((sid) => (
          <button
            key={sid}
            role="radio"
            aria-checked={!custom && id === sid}
            className={`size-chip${!custom && id === sid ? ' on' : ''}`}
            onClick={() => {
              setCustom(false);
              choose(dimsFor(sid, sid === 'slide' ? 'landscape' : orientation));
            }}
          >
            <span className="size-shape" style={{ aspectRatio: `${PAGE_SIZES[sid].width} / ${PAGE_SIZES[sid].height}` }} />
            <span className="size-name">{PAGE_SIZES[sid].label}</span>
            <small>{PAGE_SIZES[sid].detail}</small>
          </button>
        ))}
        <button className={`size-chip${custom ? ' on' : ''}`} role="radio" aria-checked={custom} onClick={() => setCustom(true)}>
          <span className="size-shape custom" />
          <span className="size-name">Custom</span>
          <small>Any size</small>
        </button>
      </div>
      {custom && (
        <div className="custom-size">
          <label>
            Width
            <input type="number" inputMode="numeric" min={50} max={1200} value={mm.w} onChange={(e) => setMm({ ...mm, w: Number(e.target.value) })} onBlur={() => onChange(customDims(mm.w, mm.h))} />
            mm
          </label>
          <label>
            Height
            <input type="number" inputMode="numeric" min={50} max={1200} value={mm.h} onChange={(e) => setMm({ ...mm, h: Number(e.target.value) })} onBlur={() => onChange(customDims(mm.w, mm.h))} />
            mm
          </label>
        </div>
      )}
      <div className="segmented" role="radiogroup" aria-label="Orientation">
        {(['portrait', 'landscape'] as const).map((o) => (
          <button key={o} className={orientation === o ? 'on' : ''} role="radio" aria-checked={orientation === o} onClick={() => flip(o)}>
            <span className={`orientation-icon ${o}`} aria-hidden="true" />
            {o === 'portrait' ? 'Portrait' : 'Landscape'}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Page options → Page size: this page or all pages, optionally scaling the ink to fit. */
export function PageSizeDialog(props: {
  current: PageDims;
  isPdfPage: boolean;
  onApply: (size: PageDims, allPages: boolean, scaleContent: boolean) => void;
  onClose: () => void;
}) {
  const [size, setSize] = useState<PageDims>(props.current);
  const [all, setAll] = useState(false);
  const [scale, setScale] = useState(false);
  return (
    <Modal title="Page size" onClose={props.onClose}>
      <PageSizePicker value={size} onChange={setSize} />
      {props.isPdfPage && <p className="settings-hint">PDF pages keep the size of the PDF; this changes the other pages.</p>}
      <div className="segmented">
        <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>
          This page
        </button>
        <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
          All pages
        </button>
      </div>
      <button className="toggle-row" role="switch" aria-checked={scale} onClick={() => setScale(!scale)}>
        <span>
          Scale ink to fit
          <small>Otherwise ink keeps its exact place and size</small>
        </span>
        <span className={`switch ${scale ? 'on' : ''}`} />
      </button>
      <div className="modal-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button
          className="primary"
          onClick={() => {
            props.onApply(size, all, scale);
            props.onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}
