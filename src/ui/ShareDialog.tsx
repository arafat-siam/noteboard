import { useEffect, useState } from 'react';
import { GOOGLE_API_KEY } from '../config';
import { db } from '../db/db';
import type { LibraryItem, Notebook } from '../model/types';
import { checkNotebookPasscode, sessionPasscode } from '../security/notebookLock';
import { createShare, listShares, lockedNotebooksIn, stopShare, type ShareRecord } from '../share/share';
import { getToken, signIn } from '../sync/auth';
import { DriveClient } from '../sync/drive';
import { Modal } from './Dialogs';
import { Icon } from './Icon';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** One link: copy, send, or stop sharing. */
function LinkRow({ record, onStopped }: { record: ShareRecord; onStopped: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="share-link">
      <input className="text-input" readOnly value={record.link} onFocus={(e) => e.target.select()} aria-label="Shared link" />
      <div className="share-link-actions">
        <button
          onClick={() =>
            void copy(record.link).then((ok) => {
              setCopied(ok);
              setTimeout(() => setCopied(false), 1800);
            })
          }
        >
          <Icon name={copied ? 'check' : 'link'} size={16} /> {copied ? 'Copied' : 'Copy link'}
        </button>
        {typeof navigator.share === 'function' && (
          <button onClick={() => void navigator.share({ title: record.name, url: record.link }).catch(() => undefined)}>
            <Icon name="share" size={16} /> Send
          </button>
        )}
        <button
          className="danger-text"
          disabled={busy}
          onClick={() => {
            if (!confirm(`Stop sharing “${record.name}”? The link stops working for everyone.`)) return;
            const token = getToken();
            if (!token) return alert('Connect Google Drive from the account menu, then try again.');
            setBusy(true);
            void stopShare(db, new DriveClient(token), record.manifestId)
              .then(onStopped)
              .catch(() => alert('Could not stop sharing. Check the internet connection and try again.'))
              .finally(() => setBusy(false));
          }}
        >
          Stop sharing
        </button>
      </div>
      <small className="share-date">Shared {new Date(record.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</small>
    </div>
  );
}

/**
 * Share a notebook or folder by link: a read-only snapshot anyone with the link can open.
 * Locked notebooks are encrypted with their passcode, so viewers must know it.
 */
export function ShareDialog({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [locked, setLocked] = useState<Notebook[]>([]);
  const [passcodes, setPasscodes] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const reload = () => void listShares(db).then((all) => setShares(all.filter((s) => s.itemId === item.id)));

  useEffect(() => {
    reload();
    void lockedNotebooksIn(db, item.id).then((list) => {
      setLocked(list);
      setPasscodes(Object.fromEntries(list.map((n) => [n.id, sessionPasscode(n.id) ?? ''])));
    });
  }, [item.id]);

  const create = async () => {
    setError('');
    const token = getToken();
    if (!token) return setError('Connect Google Drive first: the shared copy is stored in your Drive.');
    const codes = new Map<string, string>();
    for (const nb of locked) {
      const code = passcodes[nb.id] ?? '';
      if (!nb.lock || !(await checkNotebookPasscode(nb.lock, code))) return setError(`The passcode for “${nb.name}” is wrong.`);
      codes.set(nb.id, code);
    }
    setProgress('Starting');
    try {
      await createShare(db, new DriveClient(token), item.id, codes, setProgress);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sharing failed. Please try again.');
    } finally {
      setProgress(null);
    }
  };

  const what = item.kind === 'folder' ? 'this folder (every notebook in it)' : 'this notebook';
  return (
    <Modal title={`Share “${item.name}”`} onClose={onClose}>
      {!GOOGLE_API_KEY ? (
        <p className="settings-hint">
          Sharing by link needs a one-time setup (a free Google API key). Follow docs/SHARING_SETUP.md, then this button
          works.
        </p>
      ) : (
        <>
          <p className="settings-hint">
            Anyone with the link can view a copy of {what} as it is now. They cannot edit it, and later changes are not
            included: share again for a new copy.
          </p>
          {locked.length > 0 && (
            <div className="share-locked">
              <div className="field-label">
                <Icon name="lock" size={14} /> Locked notebooks stay locked
              </div>
              <p className="settings-hint">The copy is encrypted with the notebook passcode. Viewers must enter it to read the notebook.</p>
              {locked.map((nb) => (
                <label key={nb.id} className="share-passcode">
                  <span>{nb.name}</span>
                  <input
                    className="text-input"
                    type="password"
                    autoComplete="off"
                    placeholder="Notebook passcode"
                    value={passcodes[nb.id] ?? ''}
                    onChange={(e) => setPasscodes({ ...passcodes, [nb.id]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {!getToken() ? (
            <button className="primary wide-button" onClick={() => signIn()}>
              <Icon name="cloud" size={18} /> Connect Google Drive
            </button>
          ) : (
            <button className="primary wide-button" disabled={!!progress} onClick={() => void create()}>
              <Icon name="link" size={18} /> {progress ?? (shares?.length ? 'Create a new link' : 'Create link')}
            </button>
          )}
          {!!shares?.length && (
            <>
              <div className="field-label">Links</div>
              {shares
                .slice()
                .reverse()
                .map((r) => (
                  <LinkRow key={r.manifestId} record={r} onStopped={reload} />
                ))}
            </>
          )}
        </>
      )}
      <div className="modal-actions">
        <button onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
