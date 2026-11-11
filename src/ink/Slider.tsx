import { useRef } from 'react';

/**
 * A slider that works the same with Apple Pencil, finger and mouse. (The browser's own range
 * input competes with the page's Pencil and finger handling on iPad.) `onInput` fires while
 * dragging (for a live preview), `onCommit` once when the Pencil / finger lifts.
 */
export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onInput: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const { value, min, max, step } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ id: number; last: number } | null>(null);

  const valueAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = min + t * (max - min);
    return Math.min(max, Math.max(min, Math.round(v / step) * step));
  };
  const fraction = (value - min) / (max - min);

  return (
    <div
      ref={trackRef}
      className="nb-slider"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${Math.round(value * 100)}%`}
      // Keep the page from treating this as writing or scrolling.
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          // Keeps the drag going when the Pencil slides off the slider.
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not essential.
        }
        const v = valueAt(e.clientX);
        dragging.current = { id: e.pointerId, last: v };
        props.onInput(v);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const d = dragging.current;
        if (!d || d.id !== e.pointerId) return;
        const v = valueAt(e.clientX);
        if (v !== d.last) {
          d.last = v;
          props.onInput(v);
        }
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const d = dragging.current;
        if (!d || d.id !== e.pointerId) return;
        dragging.current = null;
        props.onCommit(d.last);
      }}
      onPointerCancel={(e) => {
        const d = dragging.current;
        if (!d || d.id !== e.pointerId) return;
        dragging.current = null;
        props.onCommit(d.last);
      }}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
        if (!delta) return;
        e.preventDefault();
        const v = Math.min(max, Math.max(min, Math.round((value + delta) / step) * step));
        props.onInput(v);
        props.onCommit(v);
      }}
    >
      <div className="nb-slider-track">
        <div className="nb-slider-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      <div className="nb-slider-thumb" style={{ left: `${fraction * 100}%` }} />
    </div>
  );
}
