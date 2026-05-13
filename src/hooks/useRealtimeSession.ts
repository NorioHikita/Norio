import { useRef, useCallback, useState } from 'react';
import type { TranscriptSegment, SessionConfig, Direction } from '../types/realtime';
import { detectLanguage } from '../utils/audioUtils';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const INSTRUCTIONS = `You are a professional simultaneous interpreter specializing in Japanese-English communication.

Your rules:
- If you hear Japanese → translate to natural, fluent English immediately
- If you hear English → translate to natural, fluent Japanese immediately
- Start speaking your translation as soon as you understand enough context — do NOT wait for the speaker to fully finish
- Output ONLY the translation in the target language. Never output the original text.
- Never add meta-commentary, explanations, or clarifications
- Match the speaker's formality and tone
- If input is unclear or just noise, stay silent`;

function newSegmentId() {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useRealtimeSession() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const onAudioChunkRef = useRef<((chunk: string) => void) | null>(null);

  // Correlate input audio items with transcript segments
  const pendingItemIdRef = useRef<string | null>(null);
  const currentSegmentIdRef = useRef<string | null>(null);
  const itemToSegmentRef = useRef<Map<string, string>>(new Map());

  const updateSegment = useCallback(
    (segId: string, patch: Partial<TranscriptSegment>) => {
      setTranscripts((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEvent = useCallback((ev: Record<string, any>) => {
    switch (ev.type) {
      case 'session.created':
      case 'session.updated':
        break;

      case 'input_audio_buffer.speech_started':
        setIsSpeaking(true);
        break;

      case 'input_audio_buffer.speech_stopped':
        setIsSpeaking(false);
        break;

      case 'input_audio_buffer.committed':
        // ev.item_id is the conversation item that will hold this audio
        pendingItemIdRef.current = ev.item_id ?? null;
        break;

      case 'response.created': {
        const segId = newSegmentId();
        const itemId = pendingItemIdRef.current;
        currentSegmentIdRef.current = segId;
        if (itemId) itemToSegmentRef.current.set(itemId, segId);

        const newSeg: TranscriptSegment = {
          id: segId,
          itemId,
          direction: 'unknown',
          inputText: '',
          outputText: '',
          inputStreaming: true,
          outputStreaming: true,
          timestamp: new Date(),
        };
        setTranscripts((prev) => [...prev, newSeg]);
        setIsTranslating(true);
        break;
      }

      case 'response.audio.delta':
        if (ev.delta) onAudioChunkRef.current?.(ev.delta as string);
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

      case 'response.audio_transcript.done': {
        const segId = currentSegmentIdRef.current;
        if (segId) updateSegment(segId, { outputStreaming: false });
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const itemId: string | undefined = ev.item_id;
        const transcript: string = ev.transcript ?? '';
        if (!itemId) break;

        const segId =
          itemToSegmentRef.current.get(itemId) ?? currentSegmentIdRef.current;

        if (segId && transcript) {
          const lang = detectLanguage(transcript);
          const direction: Direction = lang === 'ja' ? 'ja-en' : 'en-ja';
          updateSegment(segId, {
            inputText: transcript,
            inputStreaming: false,
            direction,
          });
        }
        break;
      }

      case 'response.done':
        setIsTranslating(false);
        if (currentSegmentIdRef.current) {
          updateSegment(currentSegmentIdRef.current, { outputStreaming: false });
        }
        break;

      case 'error':
        console.error('Realtime API error:', ev);
        setError(
          `API エラー: ${(ev.error as Record<string, string>)?.message ?? 'Unknown error'}`,
        );
        break;
    }
  }, [updateSegment]);

  const connect = useCallback(
    (config: SessionConfig, onAudioChunk: (chunk: string) => void) => {
      onAudioChunkRef.current = onAudioChunk;
      setIsConnecting(true);
      setError(null);

      const ws = new WebSocket(`${REALTIME_URL}?model=${MODEL}`, [
        'realtime',
        `openai-insecure-api-key.${config.apiKey}`,
        'openai-beta.realtime-v1',
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);

        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: INSTRUCTIONS,
              voice: config.voice,
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              input_audio_transcription: { model: 'whisper-1' },
              turn_detection: {
                type: 'server_vad',
                threshold: config.vadThreshold,
                prefix_padding_ms: 300,
                silence_duration_ms: config.silenceDurationMs,
              },
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(event.data as string));
        } catch (e) {
          console.error('Failed to parse event:', e);
        }
      };

      ws.onerror = () => {
        setError('WebSocket 接続エラーが発生しました');
        setIsConnecting(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        setIsSpeaking(false);
        setIsTranslating(false);
      };
    },
    [handleEvent],
  );

  const sendAudioChunk = useCallback((base64: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }),
      );
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setIsSpeaking(false);
    setIsTranslating(false);
    itemToSegmentRef.current.clear();
    pendingItemIdRef.current = null;
    currentSegmentIdRef.current = null;
  }, []);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    itemToSegmentRef.current.clear();
  }, []);

  return {
    isConnected,
    isConnecting,
    isSpeaking,
    isTranslating,
    error,
    transcripts,
    connect,
    disconnect,
    sendAudioChunk,
    clearTranscripts,
  };
}
