import { useEffect, useRef, useState } from 'react';
import { displayDegrees, getGuide, onGuideChange, setGuide, snapAngle, type Guide } from '../ink/guides';
import { Icon } from './Icon';

/** Millimetres per page unit (96 dpi). */
const MM_PER_UNIT = 25.4 / 96;

/** Shows the ruler or protractor and lets fingers (or a mouse) move and rotate it. */
export function GuideOverlay({ scale }: { scale: number }) {
  const [guide, setLocal] = useState<Guide | null>(getGuide);
  useEffect(() => onGuideChange(() => setLocal(getGuide())), []);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ guide: Guide; points: Map<number, { x: number; y: number }>; mode: 'move' | 'rotate' } | null>(null);

  if (!guide) return null;

  const begin = (e: React.PointerEvent, mode: 'move' | 'rotate') => {
    e.stopPropagation();
    e.preventDefault();
    // The Pencil draws along the edge, it doesn't push the ruler around.
    if (e.pointerType === 'pen' && mode === 'move') return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { guide: { ...guide }, points: new Map(touches.current), mode: touches.current.size > 1 ? 'rotate' : mode };
  };
  const move = (e: React.PointerEvent) => {
    if (!touches.current.has(e.pointerId) || !start.current) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    const ids = [...touches.current.keys()];
    if (ids.length >= 2 && s.points.size >= 2) {
      // Two fingers: move with their middle, turn with the line between them.
      const [a0, b0] = ids.slice(0, 2).map((id) => s.points.get(id)!);
      const [a1, b1] = ids.slice(0, 2).map((id) => touches.current.get(id)!);
      if (!a0 || !b0 || !a1 || !b1) return;
      const turn = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
      const dx = (a1.x + b1.x) / 2 - (a0.x + b0.x) / 2;
      const dy = (a1.y + b1.y) / 2 - (a0.y + b0.y) / 2;
      setGuide({ ...s.guide, cx: s.guide.cx + dx, cy: s.guide.cy + dy, angle: snapAngle(s.guide.angle + turn) });
      return;
    }
    const p0 = s.points.get(e.pointerId);
    if (!p0) return;
    if (s.mode === 'rotate') {
      const before = Math.atan2(p0.y - s.guide.cy, p0.x - s.guide.cx);
      const now = Math.atan2(e.clientY - s.guide.cy, e.clientX - s.guide.cx);
      setGuide({ ...s.guide, angle: snapAngle(s.guide.angle + now - before) });
    } else {
      setGuide({ ...s.guide, cx: s.guide.cx + e.clientX - p0.x, cy: s.guide.cy + e.clientY - p0.y });
    }
  };
  const end = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    const g = getGuide();
    start.current = touches.current.size && g ? { guide: g, points: new Map(touches.current), mode: 'move' } : null;
  };
  const handlers = (mode: 'move' | 'rotate') => ({
    onPointerDown: (e: React.PointerEvent) => begin(e, mode),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  });

  const deg = displayDegrees(guide.angle);
  const close = (
    <button className="guide-close" aria-label="Put away" onPointerDown={(e) => e.stopPropagation()} onClick={() => setGuide(null)}>
      <Icon name="close" size={16} />
    </button>
  );

  if (guide.kind === 'ruler') {
    const pxPerMm = scale / MM_PER_UNIT;
    const ticks: JSX.Element[] = [];
    const count = Math.floor(guide.length / pxPerMm);
    for (let i = 0; i <= count; i++) {
      const x = i * pxPerMm;
      const h = i % 10 === 0 ? 18 : i % 5 === 0 ? 12 : 7;
      if (pxPerMm < 2.5 && i % 5 !== 0) continue; // zoomed out: only every 5 mm
      ticks.push(<line key={i} x1={x} y1={0} x2={x} y2={h} />);
      if (i % 10 === 0 && i > 0) ticks.push(<text key={`t${i}`} x={x} y={30}>{i / 10}</text>);
    }
    return (
      <div className="guide-layer" aria-hidden={false}>
        <div
          className="ruler"
          role="group"
          aria-label={`Ruler, ${deg} degrees`}
          style={{
            width: guide.length,
            height: guide.width,
            transform: `translate(${guide.cx - guide.length / 2}px, ${guide.cy - guide.width / 2}px) rotate(${guide.angle}rad)`,
          }}
          {...handlers('move')}
        >
          <svg className="ruler-ticks" width={guide.length} height={guide.width}>
            {ticks}
          </svg>
          <div className="ruler-angle">{deg}°</div>
          {close}
          <div className="guide-rotate" aria-label="Rotate" {...handlers('rotate')}>
            <Icon name="sync" size={16} />
          </div>
        </div>
      </div>
    );
  }

  const r = guide.radius;
  const marks: JSX.Element[] = [];
  for (let d = 0; d <= 180; d += 5) {
    const a = (-d * Math.PI) / 180;
    const len = d % 30 === 0 ? 16 : d % 10 === 0 ? 11 : 6;
    marks.push(
      <line key={d} x1={r + Math.cos(a) * r} y1={r + Math.sin(a) * r} x2={r + Math.cos(a) * (r - len)} y2={r + Math.sin(a) * (r - len)} />,
    );
    if (d % 30 === 0)
      marks.push(
        <text key={`t${d}`} x={r + Math.cos(a) * (r - 28)} y={r + Math.sin(a) * (r - 28) + 4}>
          {d}
        </text>,
      );
  }
  return (
    <div className="guide-layer">
      <div
        className="protractor"
        role="group"
        aria-label={`Protractor, ${deg} degrees`}
        style={{
          width: r * 2,
          height: r + 18,
          transform: `translate(${guide.cx - r}px, ${guide.cy - r}px) rotate(${guide.angle}rad)`,
          transformOrigin: `${r}px ${r}px`,
        }}
        {...handlers('move')}
      >
        <svg width={r * 2} height={r + 18} className="protractor-svg">
          <path d={`M0 ${r} A${r} ${r} 0 0 1 ${r * 2} ${r} Z`} className="protractor-body" />
          {marks}
          <line x1={r} y1={r} x2={r} y2={r - 14} />
          <circle cx={r} cy={r} r={3} />
        </svg>
        <div className="ruler-angle protractor-angle">{deg}°</div>
        {close}
        <div className="guide-rotate" aria-label="Rotate" {...handlers('rotate')}>
          <Icon name="sync" size={16} />
        </div>
      </div>
    </div>
  );
}

/** Puts the ruler or protractor on screen (or away again). */
export function toggleGuide(kind: 'ruler' | 'protractor'): void {
  const current = getGuide();
  if (current?.kind === kind) {
    setGuide(null);
    return;
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  setGuide(
    kind === 'ruler'
      ? { kind, cx, cy, angle: 0, length: Math.min(window.innerWidth * 0.9, 1000), width: 76 }
      : { kind, cx, cy: cy + 80, angle: 0, radius: Math.min(170, window.innerWidth * 0.3) },
  );
}
