import { useRef, useCallback, useState } from 'react';
import { float32ToPCM16, pcm16ToBase64, calculateRMS, SAMPLE_RATE } from '../utils/audioUtils';

const BUFFER_SIZE = 2048;
const VAD_THRESHOLD = 0.012; // RMS amplitude threshold for speech detection
const VAD_SILENCE_MS = 350;  // silence duration before treating speech as ended

export function useAudioCapture() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [volume, setVolume] = useState(0);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Callbacks (set at start time)
  const onAudioChunkRef = useRef<((chunk: string) => void) | null>(null);
  const onChunkReadyRef = useRef<(() => void) | null>(null);

  // Playback suppression
  const isPlayingRef = useRef(false);

  // VAD state
  const isSpeakingRef = useRef(false);
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
    setIsSpeechDetected(true);

    // Start interval: commit a chunk every chunkIntervalMs while speaking
    chunkTimerRef.current = setInterval(() => {
      if (hasBufferedAudioRef.current) {
        hasBufferedAudioRef.current = false;
        onChunkReadyRef.current?.();
      }
    }, chunkIntervalMsRef.current);
  }, []);

  const fireSpeechStop = useCallback(() => {
    if (!isSpeakingRef.current) return;
    isSpeakingRef.current = false;
    setIsSpeechDetected(false);

    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    // Commit whatever remains in the buffer
    if (hasBufferedAudioRef.current) {
      hasBufferedAudioRef.current = false;
      onChunkReadyRef.current?.();
    }
  }, []);

  const start = useCallback(
    async (
      onAudioChunk: (chunk: string) => void,
      onChunkReady: () => void,
      chunkIntervalMs = 1500,
    ) => {
      onAudioChunkRef.current = onAudioChunk;
      onChunkReadyRef.current = onChunkReady;
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
        if (isPlayingRef.current) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const rms = calculateRMS(inputData);
        setVolume(rms);

        if (rms > VAD_THRESHOLD) {
          // Cancel any pending silence timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          fireSpeechStart();

          // Append audio to the session buffer
          const base64 = pcm16ToBase64(float32ToPCM16(inputData));
          onAudioChunkRef.current?.(base64);
          hasBufferedAudioRef.current = true;
        } else if (isSpeakingRef.current && !silenceTimerRef.current) {
          // Start silence countdown
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
    setIsCapturing(false);
    setVolume(0);
    setIsSpeechDetected(false);
  }, []);

  return { isCapturing, volume, isSpeechDetected, start, stop, setIsPlaying };
}
