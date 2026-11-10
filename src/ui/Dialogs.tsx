import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COVER_COLORS, type ID, type PaperTemplate } from '../model/types';
import { TEMPLATE_LABELS, templateStyle } from '../ink/templates';
import type { LibraryState } from './useLibrary';
import { isWithin } from '../db/library';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function PromptDialog(props: {
  title: string;
  initial?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = () => {
    if (!value.trim()) return;
    props.onConfirm(value);
    props.onClose();
  };
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <input
        ref={input}
        className="text-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="modal-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button className="primary" onClick={submit} disabled={!value.trim()}>
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function NewNotebookDialog(props: {
  onCreate: (name: string, template: PaperTemplate, color: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('Untitled Notebook');
  const [template, setTemplate] = useState<PaperTemplate>('ruled');
  const [color, setColor] = useState(COVER_COLORS[0]!);
  const create = () => {
    if (!name.trim()) return;
    props.onCreate(name, template, color);
    props.onClose();
  };
  return (
    <Modal title="New Notebook" onClose={props.onClose}>
      <label className="field-label">Name</label>
      <input
        className="text-input"
        value={name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <label className="field-label">Paper</label>
      <div className="template-picker">
        {(Object.keys(TEMPLATE_LABELS) as PaperTemplate[]).map((t) => (
          <button key={t} className={`template-option ${t === template ? 'selected' : ''}`} onClick={() => setTemplate(t)}>
            <span className="template-swatch" style={templateStyle(t, 0.12)} />
            {TEMPLATE_LABELS[t]}
          </button>
        ))}
      </div>
      <label className="field-label">Cover</label>
      <ColorRow colors={COVER_COLORS} value={color} onChange={setColor} />
      <div className="modal-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button className="primary" onClick={create}>
          Create
        </button>
      </div>
    </Modal>
  );
}

export function ColorRow({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-row">
      {colors.map((c) => (
        <button
          key={c}
          className={`color-dot ${c === value ? 'selected' : ''}`}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/** Folder tree picker for "Move to…". Folders being moved (and their insides) are disabled. */
export function MoveDialog(props: {
  library: LibraryState;
  movingIds: ID[];
  onMove: (folderId: ID | null) => void;
  onClose: () => void;
}) {
  const { library, movingIds } = props;
  const [target, setTarget] = useState<ID | null>(null);
  const blocked = (id: ID) => movingIds.some((m) => isWithin(library.byId, id, m));

  const renderLevel = (parentId: ID | null, depth: number): ReactNode =>
    library.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((f) => (
        <div key={f.id}>
          <button
            className={`tree-row ${target === f.id ? 'selected' : ''}`}
            style={{ paddingLeft: 12 + depth * 18 }}
            disabled={blocked(f.id)}
            onClick={() => setTarget(f.id)}
          >
            <FolderGlyph color={f.color} /> {f.name}
          </button>
          {renderLevel(f.id, depth + 1)}
        </div>
      ));

  return (
    <Modal title={`Move ${movingIds.length} item${movingIds.length === 1 ? '' : 's'}`} onClose={props.onClose}>
      <div className="tree-picker">
        <button className={`tree-row ${target === null ? 'selected' : ''}`} onClick={() => setTarget(null)}>
          📚 Library
        </button>
        {renderLevel(null, 1)}
      </div>
      <div className="modal-actions">
        <button onClick={props.onClose}>Cancel</button>
        <button
          className="primary"
          onClick={() => {
            props.onMove(target);
            props.onClose();
          }}
        >
          Move Here
        </button>
      </div>
    </Modal>
  );
}

export function FolderGlyph({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="folder-glyph">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.5h7A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill={color} />
    </svg>
  );
}
