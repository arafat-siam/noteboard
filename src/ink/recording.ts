import type { ID } from '../model/types';

/**
 * Audio recording and playback state shared by the editor and its pages (like Notability):
 * ink written while recording remembers its moment in the recording; during playback, ink
 * written later than the current moment is shown faded, and tapping ink jumps to it.
 */
let recording: { rec: ID; startedAt: number } | null = null;
let playback: { rec: ID; t: number } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function startRecordingSession(rec: ID): void {
  recording = { rec, startedAt: performance.now() };
  notify();
}

export function stopRecordingSession(): void {
  recording = null;
  notify();
}

export function isRecording(): boolean {
  return !!recording;
}

/** The audio stamp for ink finished right now (undefined when not recording). */
export function audioStamp(): { rec: ID; t: number } | undefined {
  return recording ? { rec: recording.rec, t: Math.round(performance.now() - recording.startedAt) } : undefined;
}

/** Which recording is playing and where (ms), or null. */
export function getPlayback(): { rec: ID; t: number } | null {
  return playback;
}

export function setPlayback(value: { rec: ID; t: number } | null): void {
  playback = value;
  notify();
}

export function onRecordingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the player to jump to a moment (tap on ink written during the recording). */
export const SEEK_RECORDING = 'noteboard-seek-recording';
export function seekRecording(rec: ID, t: number): void {
  window.dispatchEvent(new CustomEvent(SEEK_RECORDING, { detail: { rec, t } }));
}

/** Audio formats Safari (audio/mp4) and other browsers (webm) can record. */
export function recorderMime(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
