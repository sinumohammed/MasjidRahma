import { useEffect, useRef, useState } from 'react';
import { transcribeAssistant } from '../services/api';

// Voice input for the Assistant: record in the browser (MediaRecorder), send
// the recording to the server, get the text back to check before sending.
// The same approach as the AI service's own web chat: speech-to-text there
// (Gemini, Whisper as backup) handles Malayalam and other languages; a
// language hint helps it, "auto" lets it detect. A recording that never got
// loud is not sent - speech-to-text writes words for silence.

const MAX_SECONDS = 120; // the server accepts 4 MB; two minutes of Opus is ~1 MB
const MIN_PEAK = 0.04;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

export const voiceSupported = () =>
  typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';

function friendlyError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked - allow it for this site in your browser settings.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return (err as Error)?.message || 'Could not record.';
}

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  cancelled: boolean;
  peak: number | null;
  audioCtx?: AudioContext;
  raf?: number;
  timer?: number;
}

export function useVoiceRecorder({ onText, onError, language }: { onText: (text: string) => void; onError: (message: string) => void; language: string }) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<Recording | null>(null);
  const callbacks = useRef({ onText, onError, language });
  callbacks.current = { onText, onError, language };

  const release = () => {
    const r = rec.current;
    if (!r) return;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop()); // the microphone indicator goes off
    r.audioCtx?.close().catch(() => {});
  };

  useEffect(() => () => release(), []);

  async function finish(r: Recording) {
    release();
    rec.current = null;
    if (r.cancelled || !r.chunks.length) return setStatus('idle');
    if (r.peak !== null && r.peak < MIN_PEAK) {
      setStatus('idle');
      return callbacks.current.onError("I didn't hear anything - check the microphone and try again.");
    }
    setStatus('transcribing');
    try {
      const type = r.recorder.mimeType || r.chunks[0].type || 'audio/webm';
      const lang = callbacks.current.language;
      const text = await transcribeAssistant(new Blob(r.chunks, { type }), lang === 'auto' ? undefined : lang);
      if (text.trim()) callbacks.current.onText(text.trim());
      else callbacks.current.onError("I couldn't make out any words - please try again.");
    } catch (err) {
      callbacks.current.onError(err instanceof Error ? err.message : 'Could not turn the recording into text.');
    } finally {
      setStatus('idle');
    }
  }

  async function start() {
    if (status !== 'idle') return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      return callbacks.current.onError(friendlyError(err));
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const r: Recording = { recorder, stream, chunks: [], cancelled: false, peak: null };
    rec.current = r;
    recorder.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    recorder.onstop = () => finish(r);

    // Loudness, only to tell silence from speech. Without Web Audio the
    // recording is sent as it is.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      r.audioCtx = new Ctx();
      const analyser = r.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      r.audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        r.raf = requestAnimationFrame(tick);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) ** 2;
        r.peak = Math.max(r.peak ?? 0, Math.min(1, Math.sqrt(sum / data.length) / 40));
      };
      r.raf = requestAnimationFrame(tick);
    } catch {
      // no Web Audio: no silence check
    }

    const startedAt = Date.now();
    setSeconds(0);
    r.timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    recorder.start();
    setStatus('recording');
  }

  function stop() {
    if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop();
  }

  function cancel() {
    const r = rec.current;
    if (!r) return;
    r.cancelled = true;
    if (r.recorder.state === 'recording') r.recorder.stop();
  }

  return { status, seconds, start, stop, cancel };
}
