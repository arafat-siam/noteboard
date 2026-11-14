/**
 * Toolbar presets (like Drawboard): named sets of pens and highlighters. One is the default,
 * used when Noteboard starts. Kept in the meta table and synced inside library.json.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type NoteboardDB } from '../db/db';
import { markLibraryChanged } from '../db/library';
import type { PenSlot } from './palette';

export interface ToolPreset {
  id: string;
  name: string;
  slots: PenSlot[];
  updatedAt: number;
}

export interface PresetState {
  presets: ToolPreset[];
  /** Deleted preset ids (so a deletion on one device isn't undone by another). */
  deletedIds: string[];
  defaultId: string | null;
  /** When the default was last chosen (last choice wins across devices). */
  defaultAt: number;
}

export const EMPTY_PRESETS: PresetState = { presets: [], deletedIds: [], defaultId: null, defaultAt: 0 };
const META_KEY = 'toolPresets';
const ACTIVE_KEY = 'noteboard.activePreset';

export async function readPresets(database: NoteboardDB = db): Promise<PresetState> {
  return (await database.getMeta<PresetState>(META_KEY)) ?? EMPTY_PRESETS;
}

/** Saves presets and marks the library for upload (presets travel in library.json). */
export async function writePresets(state: PresetState, database: NoteboardDB = db, sync = true): Promise<void> {
  await database.setMeta(META_KEY, state);
  if (sync) await markLibraryChanged(database);
}

export function usePresets(): PresetState | undefined {
  return useLiveQuery(() => readPresets(), []);
}

/** The preset in hand on this device for this session (a new session starts with the default). */
export function activePresetId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActivePresetId(id: string): void {
  try {
    sessionStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* private mode */
  }
}

/**
 * Per-preset last-writer-wins; deletions are sticky; the most recently chosen default wins.
 * `changed` says whether the result differs from `local`.
 */
export function mergePresets(local: PresetState, remote: PresetState): { merged: PresetState; localChanged: boolean; remoteChanged: boolean } {
  const deleted = new Set([...local.deletedIds, ...remote.deletedIds]);
  const byId = new Map<string, ToolPreset>();
  for (const p of [...remote.presets, ...local.presets]) {
    if (deleted.has(p.id)) continue;
    const other = byId.get(p.id);
    // Local wins ties (it comes second).
    if (!other || p.updatedAt >= other.updatedAt) byId.set(p.id, p);
  }
  const presets = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  const fromRemote = remote.defaultAt > local.defaultAt;
  let defaultId = fromRemote ? remote.defaultId : local.defaultId;
  const defaultAt = Math.max(local.defaultAt, remote.defaultAt);
  if (defaultId && !byId.has(defaultId)) defaultId = presets[0]?.id ?? null;
  const merged: PresetState = { presets, deletedIds: [...deleted].sort(), defaultId, defaultAt };
  const key = (s: PresetState) =>
    JSON.stringify({ p: [...s.presets].sort((a, b) => a.id.localeCompare(b.id)), d: [...s.deletedIds].sort(), id: s.defaultId, at: s.defaultAt });
  return { merged, localChanged: key(merged) !== key(local), remoteChanged: key(merged) !== key(remote) };
}
