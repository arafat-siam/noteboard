import { useRef, useState } from 'react';
import { db } from '../db/db';
import { exportBackup, importBackup, shareOrDownload } from '../export/exporters';
import { SecurityDialog } from '../security/SecurityDialog';
import { Modal } from './Dialogs';
import { Icon } from './Icon';
import { act } from './useLibrary';
import { useTheme, type ThemeChoice } from './theme';

/** App settings: appearance, security, backups. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useTheme();
  const [securityOpen, setSecurityOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (securityOpen) return <SecurityDialog onClose={() => setSecurityOpen(false)} />;

  const themes: { value: ThemeChoice; label: string; icon: 'display' | 'sun' | 'moon' }[] = [
    { value: 'system', label: 'Automatic', icon: 'display' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <section>
          <div className="field-label">Appearance</div>
          <div className="theme-choices" role="radiogroup" aria-label="Appearance">
            {themes.map((t) => (
              <button key={t.value} role="radio" aria-checked={theme === t.value} className={`theme-choice ${theme === t.value ? 'on' : ''}`} onClick={() => setTheme(t.value)}>
                <span className={`theme-preview ${t.value}`}>
                  <Icon name={t.icon} size={20} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <p className="settings-hint">Automatic matches the iPad's appearance setting. Pages remain white so ink colours display accurately.</p>
        </section>

        <section>
          <div className="field-label">Security</div>
          <div className="menu-list">
            <button onClick={() => setSecurityOpen(true)}>
              <Icon name="shield" size={18} /> Passcode and lock
            </button>
          </div>
        </section>

        <section>
          <div className="field-label">Backup</div>
          <div className="menu-list">
            <button
              onClick={() =>
                void exportBackup(db).then((b) => shareOrDownload(b, `Noteboard backup ${new Date().toISOString().slice(0, 10)}.json`))
              }
            >
              <Icon name="download" size={18} /> Export a full backup
            </button>
            <button onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={18} /> Restore from a backup
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void act(async () => alert(`Imported ${await importBackup(db, file)} items.`));
            }}
          />
          <p className="settings-hint">Restoring merges the backup into your library. Nothing you have now is overwritten.</p>
        </section>
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
