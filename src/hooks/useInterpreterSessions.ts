import { useRef, useCallback, useState } from 'react';
import type { SessionConfig, SpeakerId, TranscriptSegment, Direction, Language } from '../types/realtime';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const LANG_LABEL: Record<Language, string> = { ja: 'Japanese', en: 'English' };
const LANG_LABEL_JA: Record<Language, string> = { ja: '日本語', en: 'English' };

function buildInstructions(myLang: Language, targetLang: Language): string {
  return `You are a translation-only tool. You have exactly one function: translate spoken ${LANG_LABEL[myLang]} into ${LANG_LABEL[targetLang]}.

ABSOLUTE RULES — zero exceptions:
1. If the audio clearly contains ${LANG_LABEL[myLang]} speech: output the ${LANG_LABEL[targetLang]} translation of the EXACT words spoken. Nothing added, nothing removed.
2. If the audio is ${LANG_LABEL[targetLang]}, another language, silence, noise, or unclear: produce ZERO output. Not one character. Silence only.
3. You are NOT a conversational assistant. You NEVER greet, instruct, guide, or comment.
4. FORBIDDEN outputs include but are not limited to: "Please speak in ${LANG_LABEL[myLang]}", "I will translate", "Please continue", "Sure", "【沈黙】", "silence", "(no speech)", "...".
5. You do NOT explain that you heard silence. You do NOT acknowledge unclear audio. You simply output nothing.
6. Your ONLY permitted output is the verbatim ${LANG_LABEL[targetLang]} translation of clearly spoken ${LANG_LABEL[myLang]} words.`;
}

// ── Output validation ──────────────────────────────────────────────────────────

// Patterns that indicate the model generated meta-commentary instead of translating
const META_PATTERNS = [
  /please (start )?speak/i,
  /i will translate/i,
  /please (go ahead|continue)/i,
  /^sure[,.]?\s/i,
  /【.*?】/,
  /^\(.*?\)$/,
  /^\.{2,}$/,
  /no speech/i,
  /silence/i,
  /沈黙/,
  /unclear/i,
  /i (don't|cannot|can't) (hear|understand)/i,
];

function isMeta(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  return META_PATTERNS.some((p) => p.test(t));
}

// If the output language is wrong (e.g. JA→EN session outputs Japanese), discard
function isWrongOutputLanguage(text: string, direction: Direction): boolean {
  const hasJapanese = /[぀-ゟ゠-ヿ一-鿿]/.test(text);
  if (direction === 'ja-en' && hasJapanese) return true;   // should be English
  if (direction === 'en-ja' && !hasJapanese && text.trim().length > 4) return true; // should be Japanese
  return false;
}

function shouldDiscard(text: string, direction: Direction): boolean {
  return text.trim() === '' || isMeta(text) || isWrongOutputLanguage(text, direction);
}

// ── Session state ──────────────────────────────────────────────────────────────

interface SessionState {
  ws: WebSocket | null;
  responseActive: boolean;
  pendingCommit: boolean;
  currentSegmentId: string | null;
  direction: Direction;
}

function newSegmentId() {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useInterpreterSessions() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);

  const onAudioPlayChunkRef = useRef<((chunk: string) => void) | null>(null);

  const sessA = useRef<SessionState>({
    ws: null, responseActive: false, pendingCommit: false,
    currentSegmentId: null, direction: 'ja-en',
  });
  const sessB = useRef<SessionState>({
    ws: null, responseActive: false, pendingCommit: false,
    currentSegmentId: null, direction: 'en-ja',
  });

  // ── Response queue ─────────────────────────────────────────────────────────

  const startResponse = useCallback((sess: SessionState) => {
    if (!sess.ws || sess.ws.readyState !== WebSocket.OPEN) return;
    sess.responseActive = true;
    sess.pendingCommit = false;
    sess.ws.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // ── Event handler ──────────────────────────────────────────────────────────

  const handleEvent = useCallback(
    (ev: Record<string, unknown>, speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const otherLang: Language = speakerCfg.language === 'ja' ? 'en' : 'ja';
      const direction = sess.direction;

      switch (ev.type) {
        case 'response.created': {
          const segId = newSegmentId();
          sess.currentSegmentId = segId;
          const seg: TranscriptSegment = {
            id: segId,
            speaker,
            direction,
            inputLabel: `${speakerCfg.name}（${LANG_LABEL_JA[speakerCfg.language]}）`,
            outputLabel: LANG_LABEL_JA[otherLang],
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
          const segId = sess.currentSegmentId;
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
          sess.responseActive = false;
          const segId = sess.currentSegmentId;
          if (segId) {
            setTranscripts((prev) => {
              const seg = prev.find((s) => s.id === segId);
              if (!seg) return prev;

              // Discard: empty, meta-commentary, or wrong output language
              if (shouldDiscard(seg.outputText, direction)) {
                return prev.filter((s) => s.id !== segId);
              }
              return prev.map((s) =>
                s.id === segId ? { ...s, outputStreaming: false } : s,
              );
            });
          }
          if (sess.pendingCommit) startResponse(sess);
          break;
        }

        case 'error':
          console.error(`Session ${speaker} error:`, ev);
          sess.responseActive = false;
          break;
      }
    },
    [startResponse],
  );

  // ── Connect ────────────────────────────────────────────────────────────────

  const connectSession = useCallback(
    (speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const otherLang: Language = speakerCfg.language === 'ja' ? 'en' : 'ja';
      sess.direction = speakerCfg.language === 'ja' ? 'ja-en' : 'en-ja';

      sess.ws?.close();

      const ws = new WebSocket(`${REALTIME_URL}?model=${MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${config.apiKey}`,
        'openai-beta.realtime-v1',
      ]);
      sess.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: buildInstructions(speakerCfg.language, otherLang),
            voice: config.voice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: null,
          },
        }));

        const aOpen = sessA.current.ws?.readyState === WebSocket.OPEN;
        const bOpen = sessB.current.ws?.readyState === WebSocket.OPEN;
        if (aOpen && bOpen) setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(event.data as string), speaker, config);
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      ws.onerror = () => console.error(`Session ${speaker} WebSocket error`);
      ws.onclose = () => {
        sess.responseActive = false;
        sess.pendingCommit = false;
        setIsConnected(false);
      };
    },
    [handleEvent],
  );

  const connect = useCallback(
    (config: SessionConfig, onAudioPlayChunk: (chunk: string) => void) => {
      onAudioPlayChunkRef.current = onAudioPlayChunk;
      connectSession('A', config);
      connectSession('B', config);
    },
    [connectSession],
  );

  // ── Audio — both sessions receive every chunk ──────────────────────────────

  const sendAudioChunk = useCallback((base64: string) => {
    for (const sess of [sessA.current, sessB.current]) {
      if (sess.ws?.readyState === WebSocket.OPEN) {
        sess.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
      }
    }
  }, []);

  const commitAndTranslate = useCallback(() => {
    for (const sess of [sessA.current, sessB.current]) {
      if (!sess.ws || sess.ws.readyState !== WebSocket.OPEN) continue;
      sess.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      if (!sess.responseActive) {
        startResponse(sess);
      } else {
        sess.pendingCommit = true;
      }
    }
  }, [startResponse]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    for (const sess of [sessA.current, sessB.current]) {
      sess.ws?.close();
      sess.ws = null;
      sess.responseActive = false;
      sess.pendingCommit = false;
    }
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
