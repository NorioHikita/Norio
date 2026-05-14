import { useRef, useCallback, useState } from 'react';
import type { SessionConfig, SpeakerId, TranscriptSegment, Direction, Language } from '../types/realtime';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const LANG_LABEL: Record<Language, string> = { ja: 'Japanese', en: 'English' };
const LANG_LABEL_JA: Record<Language, string> = { ja: '日本語', en: 'English' };

/**
 * Each session is given a strict "only respond if MY language is spoken" instruction.
 * If the wrong language is heard, the model outputs nothing → automatic speaker routing
 * without any button presses.
 */
function buildInstructions(myLang: Language, targetLang: Language): string {
  return `You are a professional simultaneous interpreter.

Your ONLY job: listen to the audio and translate ${LANG_LABEL[myLang]} into ${LANG_LABEL[targetLang]}.

Rules — follow these exactly:
1. If the speaker is speaking ${LANG_LABEL[myLang]}: immediately begin your ${LANG_LABEL[targetLang]} translation. Start as soon as you understand the first phrase — do NOT wait for the speaker to finish.
2. If the speech is in ${LANG_LABEL[targetLang]} or any other language: output NOTHING. Complete silence. Do not acknowledge, do not explain, just stay silent.
3. Output ONLY the ${LANG_LABEL[targetLang]} translation — never repeat the original ${LANG_LABEL[myLang]}.
4. Match the speaker's tone, formality, and pace.
5. If you hear only silence or ambient noise: output NOTHING.`;
}

interface SessionState {
  ws: WebSocket | null;
  responseActive: boolean;
  pendingCommit: boolean;
  currentSegmentId: string | null;
}

function newSegmentId() {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useInterpreterSessions() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);

  const onAudioPlayChunkRef = useRef<((chunk: string) => void) | null>(null);

  const sessA = useRef<SessionState>({
    ws: null, responseActive: false, pendingCommit: false, currentSegmentId: null,
  });
  const sessB = useRef<SessionState>({
    ws: null, responseActive: false, pendingCommit: false, currentSegmentId: null,
  });

  // ── Response queue ──────────────────────────────────────────────────────────

  const startResponse = useCallback((sess: SessionState) => {
    if (!sess.ws || sess.ws.readyState !== WebSocket.OPEN) return;
    sess.responseActive = true;
    sess.pendingCommit = false;
    sess.ws.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // ── Event handler ───────────────────────────────────────────────────────────

  const handleEvent = useCallback(
    (ev: Record<string, unknown>, speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const otherLang: Language = speakerCfg.language === 'ja' ? 'en' : 'ja';
      const direction: Direction = speakerCfg.language === 'ja' ? 'ja-en' : 'en-ja';

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

        // When the model decides to stay silent, the response will complete with no audio/text.
        // We remove the empty placeholder segment to keep the transcript clean.
        case 'response.done': {
          sess.responseActive = false;
          const segId = sess.currentSegmentId;
          if (segId) {
            setTranscripts((prev) => {
              const seg = prev.find((s) => s.id === segId);
              // Drop empty segments (model stayed silent for the wrong language)
              if (seg && seg.outputText.trim() === '') {
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

  // ── Connect ─────────────────────────────────────────────────────────────────

  const connectSession = useCallback(
    (speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const otherLang: Language = speakerCfg.language === 'ja' ? 'en' : 'ja';

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
            turn_detection: null, // manual chunking for minimal latency
          },
        }));

        const aReady = sessA.current.ws?.readyState === WebSocket.OPEN;
        const bReady = sessB.current.ws?.readyState === WebSocket.OPEN;
        if (aReady && bReady) setIsConnected(true);
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

  // ── Audio routing — BOTH sessions receive every chunk ───────────────────────

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

  // ── Disconnect ──────────────────────────────────────────────────────────────

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
