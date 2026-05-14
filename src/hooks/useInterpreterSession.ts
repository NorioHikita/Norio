import { useRef, useCallback, useState } from 'react';
import type { SessionConfig, TranscriptSegment, Direction } from '../types/realtime';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const INSTRUCTIONS = `You are a professional simultaneous interpreter working between Japanese and English.

Your ONLY function is translation. Follow these rules exactly:

1. If you hear Japanese speech → translate to natural, fluent English immediately
2. If you hear English speech → translate to natural, fluent Japanese immediately
3. Begin your translation as soon as you understand the first phrase — do NOT wait for the speaker to finish
4. Output ONLY the translated words. Never output the original language.
5. If you hear silence, noise, or audio too unclear to translate → output absolutely NOTHING. Zero characters.
6. You are NOT a conversational assistant. NEVER say things like:
   - "I'm sorry..."
   - "Please speak in..."
   - "I will translate..."
   - "[沈黙]" "[Silence]" "(no speech)"
   - Any explanation or commentary whatsoever
7. Your output must be ONLY the translation of clearly spoken words.`;

// ── Output validation ──────────────────────────────────────────────────────────

const META_PATTERNS = [
  /^i'?m sorry/i,
  /please (start )?speak/i,
  /i (will|can) translate/i,
  /please (go ahead|continue)/i,
  /^sure[,.\s]/i,
  /\[.*?(沈黙|silence|silent).*?\]/i,
  /【.*?】/,
  /^\(.*?\)$/,
  /no (clear )?speech/i,
  /silence/i,
  /沈黙/,
  /i (don't|cannot|can't) (hear|understand|detect)/i,
  /not in (japanese|english)/i,
  /^\.{2,}$/,
];

function isMeta(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || META_PATTERNS.some((p) => p.test(t));
}

function detectDirection(text: string): Direction {
  const hasJapanese = /[぀-ゟ゠-ヿ一-鿿]/.test(text);
  return hasJapanese ? 'en-ja' : 'ja-en';
}

function newSegmentId() {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useInterpreterSession() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const onAudioPlayChunkRef = useRef<((chunk: string) => void) | null>(null);

  const responseActiveRef = useRef(false);
  const pendingCommitRef = useRef(false);
  const currentSegmentIdRef = useRef<string | null>(null);

  // ── Response queue ─────────────────────────────────────────────────────────

  const startResponse = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    responseActiveRef.current = true;
    pendingCommitRef.current = false;
    wsRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // ── Events ─────────────────────────────────────────────────────────────────

  const handleEvent = useCallback(
    (ev: Record<string, unknown>, config: SessionConfig) => {
      switch (ev.type) {
        case 'response.created': {
          const segId = newSegmentId();
          currentSegmentIdRef.current = segId;
          const seg: TranscriptSegment = {
            id: segId,
            speaker: 'A',       // placeholder; overwritten at response.done
            direction: 'ja-en', // placeholder
            inputLabel: '…',
            outputLabel: '…',
            outputText: '',
            outputStreaming: true,
            timestamp: new Date(),
          };
          setTranscripts((prev) => [...prev, seg]);
          break;
        }

        case 'response.audio.delta':
          if (ev.delta) onAudioPlayChunkRef.current?.(ev.delta as string);
          break;

        case 'response.audio_transcript.delta': {
          const segId = currentSegmentIdRef.current;
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
          const segId = currentSegmentIdRef.current;
          if (segId) {
            setTranscripts((prev) => {
              const seg = prev.find((s) => s.id === segId);
              if (!seg) return prev;

              // Drop empty or meta-commentary segments
              if (isMeta(seg.outputText)) {
                return prev.filter((s) => s.id !== segId);
              }

              // Determine direction from what the model output
              const direction = detectDirection(seg.outputText);
              const isJaOut = direction === 'en-ja';

              // Determine speaker labels from config
              const speakerWhoSpoke =
                isJaOut ? config.speakerB : config.speakerA; // B spoke English → JA out
              const outputLang = isJaOut ? '日本語' : 'English';

              return prev.map((s) =>
                s.id === segId
                  ? {
                      ...s,
                      direction,
                      speaker: speakerWhoSpoke.id,
                      inputLabel: `${speakerWhoSpoke.name}（${isJaOut ? 'English' : '日本語'}）`,
                      outputLabel: outputLang,
                      outputStreaming: false,
                    }
                  : s,
              );
            });
          }
          if (pendingCommitRef.current) startResponse();
          break;
        }

        case 'error':
          console.error('Session error:', ev);
          responseActiveRef.current = false;
          break;
      }
    },
    [startResponse],
  );

  // ── Connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(
    (config: SessionConfig, onAudioPlayChunk: (chunk: string) => void) => {
      onAudioPlayChunkRef.current = onAudioPlayChunk;
      wsRef.current?.close();

      const ws = new WebSocket(`${REALTIME_URL}?model=${MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${config.apiKey}`,
        'openai-beta.realtime-v1',
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: INSTRUCTIONS,
            voice: config.voice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: null,
          },
        }));
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(event.data as string), config);
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      ws.onerror = () => console.error('WebSocket error');
      ws.onclose = () => {
        responseActiveRef.current = false;
        pendingCommitRef.current = false;
        setIsConnected(false);
      };
    },
    [handleEvent],
  );

  // ── Audio ──────────────────────────────────────────────────────────────────

  const sendAudioChunk = useCallback((base64: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      }));
    }
  }, []);

  const commitAndTranslate = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    if (!responseActiveRef.current) {
      startResponse();
    } else {
      pendingCommitRef.current = true;
    }
  }, [startResponse]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    responseActiveRef.current = false;
    pendingCommitRef.current = false;
    setIsConnected(false);
  }, []);

  const clearTranscripts = useCallback(() => setTranscripts([]), []);

  return {
    isConnected,
    transcripts,
    connect,
    disconnect,
    sendAudioChunk,
    commitAndTranslate,
    clearTranscripts,
  };
}
