import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { addRecording, deleteRecording, renameRecording } from '../db/library';
import { Slider } from '../ink/Slider';
import {
  formatDuration,
  recorderMime,
  SEEK_RECORDING,
  setPlayback,
  startRecordingSession,
  stopRecordingSession,
} from '../ink/recording';
import type { Notebook, Recording } from '../model/types';
import { sync } from '../sync/instance';
import { Icon } from './Icon';

/** The microphone button in the editor bar, with the recordings panel it opens. */
export function RecordingsButton({ notebook }: { notebook: Notebook }) {
  const [open, setOpen] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number } | null>(null);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (recordingSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recordingSince]);

  const stop = () => {
    if (recorder.current && recorder.current.rec.state !== 'inactive') recorder.current.rec.stop();
  };
  // Leaving the notebook ends (and saves) a recording in progress.
  useEffect(() => () => stop(), []);

  const start = async () => {
    setError('');
    const mime = recorderMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setError('Recording is not supported in this browser.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError('Noteboard needs microphone access. Allow it in the prompt, or in Settings > Safari > Microphone.');
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    const started = Date.now();
    const id = crypto.randomUUID();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      stopRecordingSession();
      setRecordingSince(null);
      recorder.current = null;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return;
      const name = `Recording ${new Date(started).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
      // The ink was stamped with this session id; the saved recording gets the same id.
      void addRecording(db, notebook.id, blob, Date.now() - started, name, id).then(() => sync.syncSoon());
    };
    rec.start(1000);
    recorder.current = { rec, stream, chunks, started };
    startRecordingSession(id);
    setRecordingSince(started);
    setNow(Date.now());
  };

  const recordings = notebook.recordings ?? [];
  return (
    <>
      <button
        className={`tool icon-tool${recordingSince !== null ? ' recording' : open ? ' on' : ''}`}
        aria-label={recordingSince !== null ? 'Recording (open to stop)' : 'Audio recordings'}
        title="Audio recordings"
        onClick={() => setOpen(!open)}
      >
        <Icon name="mic" size={22} />
        {recordingSince !== null && <span className="rec-time">{formatDuration(now - recordingSince)}</span>}
      </button>
      {open && (
        <div className="recordings-panel" role="dialog" aria-label="Audio recordings">
          <div className="recordings-head">
            <strong>Audio</strong>
            <button className="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          {recordingSince !== null ? (
            <button className="record-button stop" onClick={stop}>
              <Icon name="stop" size={18} filled /> Stop · {formatDuration(now - recordingSince)}
            </button>
          ) : (
            <button className="record-button" onClick={() => void start()}>
              <span className="record-dot" /> Record
            </button>
          )}
          <p className="settings-hint">
            What you write while recording is linked to the audio. Keep Noteboard open: the iPad stops recording when you switch
            apps or lock the screen.
          </p>
          {error && <p className="form-error">{error}</p>}
          <div className="recordings-list">
            {recordings
              .slice()
              .reverse()
              .map((r) => (
                <RecordingRow
                  key={r.id}
                  notebookId={notebook.id}
                  recording={r}
                  active={playingId === r.id}
                  onActivate={() => setPlayingId(playingId === r.id ? null : r.id)}
                />
              ))}
            {!recordings.length && <p className="muted recordings-empty">No recordings in this notebook yet.</p>}
          </div>
        </div>
      )}
    </>
  );
}

function RecordingRow(props: { notebookId: string; recording: Recording; active: boolean; onActivate: () => void }) {
  const { recording: r } = props;
  return (
    <div className={`recording-row${props.active ? ' active' : ''}`}>
      <div className="recording-info" onClick={props.onActivate} role="button" tabIndex={0}>
        <span className="recording-name">{r.name}</span>
        <span className="muted">{formatDuration(r.durationMs)}</span>
      </div>
      <div className="recording-actions">
        <button className="icon-button" aria-label={props.active ? 'Close player' : 'Play'} onClick={props.onActivate}>
          <Icon name={props.active ? 'close' : 'play'} size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Rename"
          onClick={() => {
            const name = prompt('Recording name', r.name);
            if (name) void renameRecording(db, props.notebookId, r.id, name).then(() => sync.syncSoon());
          }}
        >
          <Icon name="pen" size={18} />
        </button>
        <button
          className="icon-button danger-text"
          aria-label="Delete recording"
          onClick={() => {
            if (confirm(`Delete “${r.name}”? The ink stays; only the audio is removed.`))
              void deleteRecording(db, props.notebookId, r.id).then(() => sync.syncSoon());
          }}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
      {props.active && <Player recording={r} />}
    </div>
  );
}

const SPEEDS = [1, 1.5, 2];

/** Plays a recording; ink appears as the audio reaches the moment it was written. */
function Player({ recording }: { recording: Recording }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(recording.durationMs / 1000);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let objectUrl: string | null = null;
    void db.files.get(recording.fileId).then((f) => {
      if (!f) return setMissing(true);
      objectUrl = URL.createObjectURL(f.data);
      setUrl(objectUrl);
    });
    setPlayback({ rec: recording.id, t: 0 });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPlayback(null);
    };
  }, [recording.id, recording.fileId]);

  useEffect(() => {
    const onSeek = (e: Event) => {
      const { rec, t } = (e as CustomEvent<{ rec: string; t: number }>).detail;
      const el = audio.current;
      if (rec !== recording.id || !el) return;
      el.currentTime = t / 1000;
      void el.play();
    };
    window.addEventListener(SEEK_RECORDING, onSeek);
    return () => window.removeEventListener(SEEK_RECORDING, onSeek);
  }, [recording.id]);

  if (missing) return <p className="settings-hint">This recording is still downloading from Google Drive.</p>;
  return (
    <div className="player">
      <audio
        ref={audio}
        src={url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          setPlayback({ rec: recording.id, t: e.currentTarget.currentTime * 1000 });
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={!url} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>
        <Icon name={playing ? 'pause' : 'play'} size={18} filled={!playing} />
      </button>
      <span className="player-time">{formatDuration(time * 1000)}</span>
      <Slider
        value={time}
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        label="Position"
        onInput={(v) => {
          setTime(v);
          setPlayback({ rec: recording.id, t: v * 1000 });
        }}
        onCommit={(v) => {
          if (audio.current) audio.current.currentTime = v;
        }}
      />
      <span className="player-time">{formatDuration(duration * 1000)}</span>
      <button
        className="speed-button"
        aria-label="Playback speed"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          setSpeed(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
      >
        {speed}×
      </button>
    </div>
  );
}
