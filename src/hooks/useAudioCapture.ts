import { useRef, useCallback, useState } from 'react';
import { float32ToPCM16, pcm16ToBase64, calculateRMS, SAMPLE_RATE } from '../utils/audioUtils';

const BUFFER_SIZE = 2048;
const VAD_THRESHOLD = 0.018;   // RMS amplitude — raise if ambient noise triggers false starts
const VAD_SILENCE_MS = 400;    // silence duration before speech-stop is declared
const MIN_SPEECH_MS = 600;     // minimum speech duration to commit (prevents noise commits)

export function useAudioCapture() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [volume, setVolume] = useState(0);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const onAudioChunkRef = useRef<((chunk: string) => void) | null>(null);
  const onChunkReadyRef = useRef<(() => void) | null>(null);
  const onDiscardRef = useRef<(() => void) | null>(null);

  const isPlayingRef = useRef(false);

  // VAD state
  const isSpeakingRef = useRef(false);
  const speechStartTimeRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasBufferedAudioRef = useRef(false);
  const chunkIntervalMsRef = useRef(1500);

  const setIsPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
  }, []);

  const fireSpeechStart = useCallback(() => {
    if (isSpeakingRef.current) return;
    isSpeakingRef.current = true;
    speechStartTimeRef.current = Date.now();
    setIsSpeechDetected(true);

    chunkTimerRef.current = setInterval(() => {
      if (hasBufferedAudioRef.current) {
        hasBufferedAudioRef.current = false;
        onChunkReadyRef.current?.();
      }
    }, chunkIntervalMsRef.current);
  }, []);

  const fireSpeechStop = useCallback(() => {
    if (!isSpeakingRef.current) return;

    const duration = speechStartTimeRef.current
      ? Date.now() - speechStartTimeRef.current
      : 0;

    isSpeakingRef.current = false;
    speechStartTimeRef.current = null;
    setIsSpeechDetected(false);

    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    if (hasBufferedAudioRef.current && duration >= MIN_SPEECH_MS) {
      hasBufferedAudioRef.current = false;
      onChunkReadyRef.current?.();
    } else {
      // Speech was too short — discard and clear the server-side buffer
      hasBufferedAudioRef.current = false;
      onDiscardRef.current?.();
    }
  }, []);

  const start = useCallback(
    async (
      onAudioChunk: (chunk: string) => void,
      onChunkReady: () => void,
      onDiscard: () => void,
      chunkIntervalMs = 1500,
    ) => {
      onAudioChunkRef.current = onAudioChunk;
      onChunkReadyRef.current = onChunkReady;
      onDiscardRef.current = onDiscard;
      chunkIntervalMsRef.current = chunkIntervalMs;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        // Suppress mic input while translation audio is playing (prevents echo)
        if (isPlayingRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const rms = calculateRMS(inputData);
        setVolume(rms);

        if (rms > VAD_THRESHOLD) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          fireSpeechStart();

          const base64 = pcm16ToBase64(float32ToPCM16(inputData));
          onAudioChunkRef.current?.(base64);
          hasBufferedAudioRef.current = true;
        } else if (isSpeakingRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null;
            fireSpeechStop();
          }, VAD_SILENCE_MS);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      setIsCapturing(true);
    },
    [fireSpeechStart, fireSpeechStop],
  );

  const stop = useCallback(() => {
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    chunkTimerRef.current = null;
    silenceTimerRef.current = null;

    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;

    isSpeakingRef.current = false;
    hasBufferedAudioRef.current = false;
    speechStartTimeRef.current = null;
    setIsCapturing(false);
    setVolume(0);
    setIsSpeechDetected(false);
  }, []);

  return { isCapturing, volume, isSpeechDetected, start, stop, setIsPlaying };
}
