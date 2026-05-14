import { useRef, useCallback, useState } from 'react';
import type { SessionConfig, SpeakerId, TranscriptSegment, Direction, Language } from '../types/realtime';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const LANG_LABEL: Record<Language, string> = { ja: 'Japanese', en: 'English' };
const LANG_LABEL_JA: Record<Language, string> = { ja: '日本語', en: 'English' };

function buildInstructions(fromLang: Language, toLang: Language): string {
  return `You are a professional simultaneous interpreter.
The speaker is speaking ${LANG_LABEL[fromLang]}. Translate their speech into ${LANG_LABEL[toLang]} simultaneously.

Critical rules:
- Begin speaking your ${LANG_LABEL[toLang]} translation AS SOON AS you understand the first phrase — do NOT wait for the speaker to finish
- Output ONLY the ${LANG_LABEL[toLang]} translation. Never output the original ${LANG_LABEL[fromLang]}.
- Speak at a natural pace that mirrors the speaker
- Match formality, tone, and nuance
- If input is just noise or silence, stay silent`;
}

interface SingleSessionState {
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

  // Per-speaker session state held in refs (not React state) to avoid stale closures
  const sessA = useRef<SingleSessionState>({
    ws: null, responseActive: false, pendingCommit: false, currentSegmentId: null,
  });
  const sessB = useRef<SingleSessionState>({
    ws: null, responseActive: false, pendingCommit: false, currentSegmentId: null,
  });

  const getSess = useCallback((speaker: SpeakerId) =>
    speaker === 'A' ? sessA.current : sessB.current,
  []);

  // ── Response queue management ──────────────────────────────────────────────

  const startResponse = useCallback((sess: SingleSessionState) => {
    if (!sess.ws || sess.ws.readyState !== WebSocket.OPEN) return;
    sess.responseActive = true;
    sess.pendingCommit = false;
    sess.ws.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // ── Event handlers per session ─────────────────────────────────────────────

  const handleEvent = useCallback(
    (ev: Record<string, unknown>, speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const direction: Direction = speakerCfg.language === 'ja' ? 'ja-en' : 'en-ja';
      const otherLang = speakerCfg.language === 'ja' ? 'en' : 'ja';

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

        case 'response.done':
          if (sess.currentSegmentId) {
            const id = sess.currentSegmentId;
            setTranscripts((prev) =>
              prev.map((s) => (s.id === id ? { ...s, outputStreaming: false } : s)),
            );
          }
          sess.responseActive = false;
          // If audio was committed while response was active, start the next response
          if (sess.pendingCommit) {
            startResponse(sess);
          }
          break;

        case 'error':
          console.error(`Session ${speaker} error:`, ev);
          sess.responseActive = false;
          break;
      }
    },
    [startResponse],
  );

  // ── Connect both sessions ──────────────────────────────────────────────────

  const connectSession = useCallback(
    (speaker: SpeakerId, config: SessionConfig) => {
      const sess = speaker === 'A' ? sessA.current : sessB.current;
      const speakerCfg = speaker === 'A' ? config.speakerA : config.speakerB;
      const otherLang = speakerCfg.language === 'ja' ? 'en' : 'ja';

      if (sess.ws) {
        sess.ws.close();
        sess.ws = null;
      }

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
            instructions: buildInstructions(speakerCfg.language, otherLang as Language),
            voice: config.voice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            // Disable server VAD — we commit manually for immediate translation
            turn_detection: null,
          },
        }));

        // Both sessions connected when both are open
        if (sessA.current.ws?.readyState === WebSocket.OPEN &&
            sessB.current.ws?.readyState === WebSocket.OPEN) {
          setIsConnected(true);
        }
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

  // ── Audio routing ──────────────────────────────────────────────────────────

  const sendAudioChunk = useCallback((base64: string, speaker: SpeakerId) => {
    const sess = getSess(speaker);
    if (sess.ws?.readyState === WebSocket.OPEN) {
      sess.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    }
  }, [getSess]);

  // Called by the chunk timer — commit current buffer and trigger translation
  const commitAndTranslate = useCallback((speaker: SpeakerId) => {
    const sess = getSess(speaker);
    if (!sess.ws || sess.ws.readyState !== WebSocket.OPEN) return;

    // Commit current audio buffer (creates a conversation item)
    sess.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));

    if (!sess.responseActive) {
      startResponse(sess);
    } else {
      // A response is in progress — flag that we have more committed audio
      sess.pendingCommit = true;
    }
  }, [getSess, startResponse]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    sessA.current.ws?.close();
    sessA.current.ws = null;
    sessA.current.responseActive = false;
    sessA.current.pendingCommit = false;

    sessB.current.ws?.close();
    sessB.current.ws = null;
    sessB.current.responseActive = false;
    sessB.current.pendingCommit = false;

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
