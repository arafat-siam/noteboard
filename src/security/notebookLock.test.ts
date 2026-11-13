import { describe, expect, it } from 'vitest';
import type { Notebook } from '../model/types';
import {
  checkNotebookPasscode,
  isNotebookUnlocked,
  lockAllNotebooks,
  makeNotebookLock,
  markNotebookUnlocked,
  notebookClosed,
  sessionPasscode,
} from './notebookLock';

const notebook = (over: Partial<Notebook>): Notebook => ({
  kind: 'notebook', id: 'nb', parentId: null, name: 'Diary', coverColor: '#000', template: 'ruled', pageIds: [],
  deletedPageIds: [], tags: [], lastOpenedAt: null, createdAt: 1, updatedAt: 1, trashedAt: null, favorite: false,
  deleted: false, ...over,
});

describe('notebook locks', () => {
  it('stores only a hash and checks the passcode', async () => {
    const lock = await makeNotebookLock('blue horse 7');
    expect(JSON.stringify(lock)).not.toContain('blue horse');
    expect(await checkNotebookPasscode(lock, 'blue horse 7')).toBe(true);
    expect(await checkNotebookPasscode(lock, 'blue horse')).toBe(false);
  });

  it('stays unlocked until closed, a timeout, or the app locks', async () => {
    const onClose = notebook({ lock: await makeNotebookLock('1234', 0) });
    expect(isNotebookUnlocked(onClose)).toBe(false);
    markNotebookUnlocked('nb', '1234');
    expect(isNotebookUnlocked(onClose)).toBe(true);
    expect(sessionPasscode('nb')).toBe('1234');
    notebookClosed(onClose);
    expect(isNotebookUnlocked(onClose)).toBe(false);

    const timed = notebook({ lock: await makeNotebookLock('1234', 5) });
    markNotebookUnlocked('nb');
    notebookClosed(timed); // closing doesn't lock a "after 5 minutes" notebook
    expect(isNotebookUnlocked(timed)).toBe(true);
    expect(isNotebookUnlocked(timed, Date.now() + 6 * 60_000)).toBe(false);

    markNotebookUnlocked('nb');
    lockAllNotebooks();
    expect(isNotebookUnlocked(timed)).toBe(false);
    expect(isNotebookUnlocked(notebook({}))).toBe(true); // no lock, always open
  });
});
