import { useState } from 'react';
import { db } from '../db/db';
import { setNotebookSettings } from '../db/library';
import type { Notebook } from '../model/types';
import {
  checkNotebookPasscode,
  isNotebookUnlocked,
  isValidNotebookPasscode,
  lockNotebook,
  makeNotebookLock,
  markNotebookUnlocked,
  NOTEBOOK_PASSCODE_MIN,
} from '../security/notebookLock';
import { pinLock } from '../security/pin';
import { Modal } from './Dialogs';
import { Icon } from './Icon';
import { act } from './useLibrary';

const RELOCK_OPTIONS: [number, string][] = [
  [0, 'When I close the notebook'],
  [5, 'After 5 minutes'],
  [15, 'After 15 minutes'],
  [60, 'After 1 hour'],
  [480, 'After 8 hours'],
];

function PasscodeField(props: { label: string; value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label className="field-label">{props.label}</label>
      <div className="passcode-field">
        <input
          className="text-input"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
        />
        <button className="link" type="button" onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </>
  );
}

/** Asks for a locked notebook's passcode. Shown instead of the notebook (or before exporting it). */
export function UnlockNotebook(props: { notebook: Notebook; onUnlocked: () => void; onCancel: () => void; inline?: boolean }) {
  const { notebook } = props;
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [appPin, setAppPin] = useState('');

  const unlock = async () => {
    if (!notebook.lock || busy) return;
    setBusy(true);
    const ok = await checkNotebookPasscode(notebook.lock, passcode);
    setBusy(false);
    if (!ok) {
      setError('Wrong passcode.');
      setPasscode('');
      return;
    }
    markNotebookUnlocked(notebook.id, passcode);
    props.onUnlocked();
  };

  const removeWithAppPin = async () => {
    setBusy(true);
    const result = await pinLock.verify(appPin);
    setBusy(false);
    if (!result.ok) {
      setError(result.waitMs > 0 ? `Too many attempts. Try again in ${Math.ceil(result.waitMs / 1000)}s.` : 'Wrong app PIN.');
      return;
    }
    await act(() => setNotebookSettings(db, notebook.id, { lock: undefined }));
    markNotebookUnlocked(notebook.id);
    props.onUnlocked();
  };

  const body = forgot ? (
    pinLock.hasPin() ? (
      <>
        <p className="lock-hint">Enter Noteboard's app PIN to remove this notebook's lock. You can set a new passcode afterwards.</p>
        <PasscodeField label="App PIN" value={appPin} onChange={(v) => setAppPin(v.replace(/\D/g, ''))} onEnter={() => void removeWithAppPin()} autoFocus />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button onClick={() => setForgot(false)}>Back</button>
          <button className="primary" disabled={busy || !appPin} onClick={() => void removeWithAppPin()}>
            Remove lock
          </button>
        </div>
      </>
    ) : (
      <>
        <p className="lock-hint">
          Without the notebook passcode it can only be unlocked with Noteboard's app PIN, and no app PIN is set on this iPad. If
          you set one later (Settings &gt; Passcode), it can be used here.
        </p>
        <div className="modal-actions">
          <button onClick={() => setForgot(false)}>Back</button>
        </div>
      </>
    )
  ) : (
    <>
      <PasscodeField label="Passcode" value={passcode} onChange={setPasscode} onEnter={() => void unlock()} autoFocus />
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="link" onClick={() => setForgot(true)}>
          Forgot passcode?
        </button>
        <span className="spacer" />
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !passcode} onClick={() => void unlock()}>
          Unlock
        </button>
      </div>
    </>
  );

  if (props.inline) {
    return (
      <div className="notebook-locked">
        <div className="notebook-locked-card">
          <div className="lock-icon">
            <Icon name="lock" size={34} />
          </div>
          <h1>{notebook.name}</h1>
          <p className="lock-hint">This notebook is locked.</p>
          {body}
        </div>
      </div>
    );
  }
  return (
    <Modal title={`Unlock “${notebook.name}”`} onClose={props.onCancel}>
      {body}
    </Modal>
  );
}

/** Set, change or remove a notebook's passcode, and when it locks again. */
export function NotebookLockDialog({ notebook, onClose }: { notebook: Notebook; onClose: () => void }) {
  const locked = !!notebook.lock;
  // Changing an existing lock needs the passcode unless it was just unlocked in this session.
  const [verified, setVerified] = useState(() => !locked || isNotebookUnlocked(notebook));
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [relock, setRelock] = useState(notebook.lock?.relockMinutes ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(!locked);

  if (!verified) {
    return <UnlockNotebook notebook={notebook} onUnlocked={() => setVerified(true)} onCancel={onClose} />;
  }

  const save = async () => {
    if (changing) {
      if (!isValidNotebookPasscode(next)) return setError(`Use at least ${NOTEBOOK_PASSCODE_MIN} characters.`);
      if (next !== again) return setError("The two passcodes don't match.");
    }
    setBusy(true);
    const lock = changing ? await makeNotebookLock(next, relock) : { ...notebook.lock!, relockMinutes: relock };
    await act(() => setNotebookSettings(db, notebook.id, { lock }));
    if (changing) markNotebookUnlocked(notebook.id, next);
    setBusy(false);
    onClose();
  };

  const remove = async () => {
    if (!confirm(`Remove the lock from “${notebook.name}”? Anyone who can open Noteboard will be able to open it.`)) return;
    await act(() => setNotebookSettings(db, notebook.id, { lock: undefined }));
    lockNotebook(notebook.id);
    onClose();
  };

  return (
    <Modal title={locked ? 'Notebook lock' : 'Lock notebook'} onClose={onClose}>
      {changing ? (
        <>
          <p className="lock-hint">
            Letters, numbers or both, at least {NOTEBOOK_PASSCODE_MIN} characters. A shared link to this notebook can only be
            opened with this passcode.
          </p>
          <PasscodeField label={locked ? 'New passcode' : 'Passcode'} value={next} onChange={setNext} autoFocus />
          <PasscodeField label="Passcode again" value={again} onChange={setAgain} onEnter={() => void save()} />
        </>
      ) : (
        <div className="menu-list">
          <button onClick={() => setChanging(true)}>
            <Icon name="lock" size={18} /> Change passcode
          </button>
        </div>
      )}
      <label className="field-label">Lock again</label>
      <select className="select full" value={relock} onChange={(e) => setRelock(Number(e.target.value))}>
        {RELOCK_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        {locked && (
          <button className="danger-text link" onClick={() => void remove()}>
            Remove lock
          </button>
        )}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {locked ? 'Save' : 'Lock'}
        </button>
      </div>
    </Modal>
  );
}
