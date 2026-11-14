import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * A button that opens a small menu below it (or above, with `up`). The menu closes on a tap
 * outside, on Escape, and after any item is chosen.
 */
export function MenuButton(props: {
  /** The button's own content. */
  children: ReactNode;
  className?: string;
  label: string;
  align?: 'left' | 'right';
  up?: boolean;
  menu: (close: () => void) => ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={rootRef}>
      <button className={props.className} aria-label={props.label} title={props.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {props.children}
      </button>
      {open && (
        <div
          className={`dropdown ${props.align === 'left' ? 'align-left' : 'align-right'}${props.up ? ' up' : ''}`}
          role="menu"
          style={props.width ? { width: props.width } : undefined}
        >
          {props.menu(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One row of a menu: icon, label, optional hint on the right, and a tick when `checked`. */
export function MenuItem(props: {
  icon?: IconName;
  label: string;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`menu-row${props.danger ? ' danger-text' : ''}`}
      role={props.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon ? <Icon name={props.icon} size={18} /> : <span className="menu-icon-space" />}
      <span className="menu-row-label">{props.label}</span>
      {props.hint && <span className="menu-hint">{props.hint}</span>}
      {props.checked && <Icon name="check" size={16} className="menu-check" />}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
