import { useRef, useCallback, useState } from 'react';
import type { SessionConfig, TranscriptSegment, Direction, SpeakerId } from '../types/realtime';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const SYSTEM_PROMPT = `You are a real-time interpreter between Japanese and English.

Strict rules with zero exceptions:
1. You hear Japanese → output the English translation only. Nothing else.
2. You hear English → output the Japanese translation only. Nothing else.
3. You hear silence, noise, or unclear audio → output absolutely nothing. Zero characters.
4. NEVER output anything except the translated words. No "I see", no "Please speak", no explanations.`;

const META_PATTERNS: RegExp[] = [
  /^[\s.…。、・ー]+$/,
  /i'?m sorry/i,
  /please (speak|say|try|go ahead|continue|repeat|start)/i,
  /i (will|can|cannot|can't|don't) (translate|hear|understand|detect|interpret)/i,
  /^(sure|ok|okay|yes|no|hmm|um|uh)[,.\s!]*$/i,
  /【[^】]*】/,
  /\[[^\]]*\]/,
  /^\([^)]*\)$/,
  /no (clear )?speech/i,
  /\bsilence\b/i,
  /\b沈黙\b/,
  /\bunclear\b/i,
  /not in (japanese|english)/i,
  /^[.…]{2,}$/,
  /translation:/i,
  /translator:/i,
];

function isMeta(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || META_PATTERNS.some((p) => p.test(t));
}

// Determine what language the model output (= what it translated INTO)
function detectDirection(text: string): Direction {
  return /[぀-ゟ゠-ヿ一-鿿]/.test(text) ? 'en-ja' : 'ja-en';
}

function newId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useInterpreterSession() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const configRef = useRef<SessionConfig | null>(null);
  const onPlayChunkRef = useRef<((chunk: string) => void) | null>(null);

  const responseActiveRef = useRef(false);
  const pendingCommitRef = useRef(false);
  const currentSegIdRef = useRef<string | null>(null);

  // ── Response flow ──────────────────────────────────────────────────────────

  const startResponse = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    responseActiveRef.current = true;
    pendingCommitRef.current = false;
    ws.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // ── Event handler ──────────────────────────────────────────────────────────

  const handleMessage = useCallback(
    (raw: string) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw);
      } catch {
        return;
      }

      const config = configRef.current;

      switch (ev.type as string) {
        case 'response.created': {
          const segId = newId();
          currentSegIdRef.current = segId;
          setTranscripts((prev) => [
            ...prev,
            {
              id: segId,
              speaker: 'A' as SpeakerId,
              direction: 'ja-en' as Direction,
              inputLabel: '通訳中…',
              outputLabel: '…',
              outputText: '',
              outputStreaming: true,
              timestamp: new Date(),
            },
          ]);
          break;
        }

        case 'response.audio.delta':
          if (ev.delta) onPlayChunkRef.current?.(ev.delta as string);
          break;

        case 'response.audio_transcript.delta': {
          const segId = currentSegIdRef.current;
          if (segId && ev.delta) {
            setTranscripts((prev) =>
              prev.map((s) =>
                s.id === segId
                  ? { ...s, outputText: s.outputText + (ev.delta as string) }
                  : s,
              ),
            );
          }
          break;
        }

        case 'response.done': {
          responseActiveRef.current = false;
          const segId = currentSegIdRef.current;
          currentSegIdRef.current = null;

          if (segId) {
            setTranscripts((prev) => {
              const seg = prev.find((s) => s.id === segId);
              if (!seg || isMeta(seg.outputText)) {
                return prev.filter((s) => s.id !== segId);
              }

              const direction = detectDirection(seg.outputText);
              const isJaOut = direction === 'en-ja';

              // Find the speaker whose native language matches the INPUT language
              const inputLang = isJaOut ? 'en' : 'ja';
              const speakerCfg = config
                ? (config.speakerA.language === inputLang ? config.speakerA : config.speakerB)
                : null;

              const speaker: SpeakerId = speakerCfg?.id ?? 'A';
              const inputLabel = speakerCfg
                ? `${speakerCfg.name}（${isJaOut ? 'English' : '日本語'}）`
                : '…';
              const outputLabel = isJaOut ? '日本語' : 'English';

              return prev.map((s) =>
                s.id === segId
                  ? { ...s, direction, speaker, inputLabel, outputLabel, outputStreaming: false }
                  : s,
              );
            });
          }

          if (pendingCommitRef.current) startResponse();
          break;
        }

        case 'error': {
          console.error('[WS] error event:', ev);
          responseActiveRef.current = false;
          const segId = currentSegIdRef.current;
          if (segId) {
            currentSegIdRef.current = null;
            setTranscripts((prev) => prev.filter((s) => s.id !== segId));
          }
          break;
        }
      }
    },
    [startResponse],
  );

  // ── Connect / Disconnect ───────────────────────────────────────────────────

  const connect = useCallback(
    (config: SessionConfig, onPlayChunk: (chunk: string) => void) => {
      configRef.current = config;
      onPlayChunkRef.current = onPlayChunk;
      wsRef.current?.close();
      responseActiveRef.current = false;
      pendingCommitRef.current = false;
      currentSegIdRef.current = null;

      const ws = new WebSocket(`${REALTIME_URL}?model=${MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${config.apiKey}`,
        'openai-beta.realtime-v1',
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: SYSTEM_PROMPT,
              voice: config.voice,
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              turn_detection: null,
            },
          }),
        );
        setIsConnected(true);
      };

      ws.onmessage = (e) => handleMessage(e.data as string);
      ws.onerror = (e) => console.error('[WS] error', e);
      ws.onclose = () => {
        responseActiveRef.current = false;
        pendingCommitRef.current = false;
        setIsConnected(false);
      };
    },
    [handleMessage],
  );

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    responseActiveRef.current = false;
    pendingCommitRef.current = false;
    currentSegIdRef.current = null;
    setIsConnected(false);
  }, []);

  // ── Audio ──────────────────────────────────────────────────────────────────

  const sendAudioChunk = useCallback((base64: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    }
  }, []);

  const commitAndTranslate = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    if (!responseActiveRef.current) {
      startResponse();
    } else {
      pendingCommitRef.current = true;
    }
  }, [startResponse]);

  // Clear the server-side audio buffer without triggering a response
  const clearAudioBuffer = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    }
  }, []);

  const clearTranscripts = useCallback(() => setTranscripts([]), []);

  return {
    isConnected,
    transcripts,
    connect,
    disconnect,
    sendAudioChunk,
    commitAndTranslate,
    clearAudioBuffer,
    clearTranscripts,
  };
}
