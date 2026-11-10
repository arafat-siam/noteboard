import { useState } from 'react';
import { Modal } from '../ui/Dialogs';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, isValidPin, pinLock } from './pin';
import { lockNow } from './AppLock';

const AUTO_LOCK_OPTIONS: [number, string][] = [
  [0, 'Immediately'],
  [1, 'After 1 minute'],
  [5, 'After 5 minutes'],
  [15, 'After 15 minutes'],
  [60, 'After 1 hour'],
];

export function SecurityDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [autoLock, setAutoLock] = useState(pinLock.autoLockMinutes());
  const [busy, setBusy] = useState(false);

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);

  const changePin = async () => {
    if (!isValidPin(next)) return setMessage({ text: `New PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`, ok: false });
    if (next !== confirmPin) return setMessage({ text: "New PINs don't match.", ok: false });
    setBusy(true);
    const result = await pinLock.changePin(current, next);
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setNext('');
      setConfirmPin('');
      setMessage({ text: 'PIN changed.', ok: true });
    } else {
      setMessage({
        text: result.waitMs > 0 ? `Too many attempts. Try again in ${Math.ceil(result.waitMs / 1000)}s.` : 'Current PIN is wrong.',
        ok: false,
      });
    }
  };

  const pinInput = (label: string, value: string, set: (v: string) => void) => (
    <>
      <label className="field-label">{label}</label>
      <input
        className="text-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => set(digitsOnly(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && void changePin()}
      />
    </>
  );

  return (
    <Modal title="Security" onClose={onClose}>
      <h3 className="dialog-subtitle">Change PIN</h3>
      {pinInput('Current PIN', current, setCurrent)}
      {pinInput('New PIN', next, setNext)}
      {pinInput('Confirm new PIN', confirmPin, setConfirmPin)}
      {message && <p className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</p>}
      <div className="modal-actions">
        <button className="primary" disabled={busy || !current || !next} onClick={() => void changePin()}>
          Change PIN
        </button>
      </div>

      <h3 className="dialog-subtitle">Auto-lock</h3>
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

      <div className="modal-actions">
        <button onClick={onClose}>Close</button>
        <button
          onClick={() => {
            onClose();
            lockNow();
          }}
        >
          🔒 Lock now
        </button>
      </div>
    </Modal>
  );
}
