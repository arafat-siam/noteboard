import { useState } from 'react';
import { Modal } from '../ui/Dialogs';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, isValidPin, pinLock, type VerifyResult } from './pin';
import { lockNow } from './AppLock';
import { Icon } from '../ui/Icon';

const AUTO_LOCK_OPTIONS: [number, string][] = [
  [0, 'Immediately'],
  [1, 'After 1 minute'],
  [5, 'After 5 minutes'],
  [15, 'After 15 minutes'],
  [60, 'After 1 hour'],
  [-1, 'Never (only when I tap Lock)'],
];

type Mode = 'overview' | 'turn-on' | 'change' | 'turn-off';

/** App passcode: turn on or off, change it, and choose when Noteboard locks itself. */
export function SecurityDialog({ onClose }: { onClose: () => void }) {
  const [hasPin, setHasPin] = useState(pinLock.hasPin());
  const [mode, setMode] = useState<Mode>('overview');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [autoLock, setAutoLock] = useState(pinLock.autoLockMinutes());
  const [busy, setBusy] = useState(false);

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);
  const reset = (m: Mode) => {
    setMode(m);
    setCurrent('');
    setNext('');
    setConfirmPin('');
    setMessage(null);
  };
  const failure = (r: Exclude<VerifyResult, { ok: true }>) =>
    setMessage({ text: r.waitMs > 0 ? `Too many attempts. Try again in ${Math.ceil(r.waitMs / 1000)}s.` : 'The current PIN is wrong.', ok: false });

  const submit = async () => {
    if (mode === 'turn-off') {
      setBusy(true);
      const r = await pinLock.turnOff(current);
      setBusy(false);
      if (!r.ok) return failure(r);
      setHasPin(false);
      reset('overview');
      setMessage({ text: 'Passcode is off. Noteboard opens without asking.', ok: true });
      return;
    }
    if (!isValidPin(next)) return setMessage({ text: `The PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`, ok: false });
    if (next !== confirmPin) return setMessage({ text: "The two new PINs don't match.", ok: false });
    setBusy(true);
    if (mode === 'turn-on') {
      await pinLock.setPin(next);
      setBusy(false);
      setHasPin(true);
      reset('overview');
      setMessage({ text: 'Passcode is on.', ok: true });
      return;
    }
    const r = await pinLock.changePin(current, next);
    setBusy(false);
    if (!r.ok) return failure(r);
    reset('overview');
    setMessage({ text: 'PIN changed.', ok: true });
  };

  const pinInput = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <>
      <label className="field-label">{label}</label>
      <input
        className="text-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => set(digitsOnly(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
    </>
  );

  if (mode !== 'overview') {
    const title = mode === 'turn-on' ? 'Turn passcode on' : mode === 'change' ? 'Change PIN' : 'Turn passcode off';
    return (
      <Modal title={title} onClose={onClose}>
        {mode !== 'turn-on' && pinInput('Current PIN', current, setCurrent, true)}
        {mode !== 'turn-off' && pinInput('New PIN', next, setNext, mode === 'turn-on')}
        {mode !== 'turn-off' && pinInput('New PIN again', confirmPin, setConfirmPin)}
        {message && <p className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</p>}
        <div className="modal-actions">
          <button onClick={() => reset('overview')}>Back</button>
          <button className={mode === 'turn-off' ? 'danger' : 'primary'} disabled={busy} onClick={() => void submit()}>
            {mode === 'turn-off' ? 'Turn off' : 'Save'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Passcode" onClose={onClose}>
      <button className="toggle-row" role="switch" aria-checked={hasPin} onClick={() => reset(hasPin ? 'turn-off' : 'turn-on')}>
        <span>
          Ask for a passcode
          <small>{hasPin ? 'Noteboard asks for your PIN when it opens' : 'Anyone holding this iPad can open Noteboard'}</small>
        </span>
        <span className={`switch ${hasPin ? 'on' : ''}`} />
      </button>
      {message && <p className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</p>}
      {hasPin && (
        <>
          <div className="menu-list">
            <button onClick={() => reset('change')}>
              <Icon name="lock" size={18} /> Change PIN
            </button>
          </div>
          <label className="field-label">Lock automatically</label>
          <select
            className="select full"
            value={autoLock}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              setAutoLock(minutes);
              pinLock.setAutoLockMinutes(minutes);
            }}
          >
            {AUTO_LOCK_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="lock-hint">How long Noteboard can stay in the background before it asks for the PIN again.</p>
        </>
      )}
      <p className="lock-hint">
        This is a lock screen, like the iPad's own. Notebooks can also have their own passcode: open a notebook's menu and
        choose Lock.
      </p>
      <div className="modal-actions">
        <button onClick={onClose}>Close</button>
        {hasPin && (
          <button
            onClick={() => {
              onClose();
              lockNow();
            }}
          >
            <Icon name="lock" size={18} /> Lock now
          </button>
        )}
      </div>
    </Modal>
  );
}
