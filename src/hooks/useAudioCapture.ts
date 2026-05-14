import { useRef, useCallback, useState } from 'react';
import { float32ToPCM16, pcm16ToBase64, calculateRMS, SAMPLE_RATE } from '../utils/audioUtils';

const BUFFER_SIZE = 2048;

// Two-threshold VAD:
// VAD_THRESHOLD   — low threshold to START tracking potential speech (volume indicator)
// SPEECH_THRESHOLD — must be EXCEEDED at least once to confirm real speech and allow commit
//   Typical values by environment:
//     Silent office / headset : SPEECH_THRESHOLD 0.030–0.050
//     Noisy environment       : raise SPEECH_THRESHOLD to 0.060–0.080
const VAD_THRESHOLD = 0.015;
const SPEECH_THRESHOLD = 0.045;

const VAD_SILENCE_MS = 500;  // silence after speech before speech-stop declared
const MIN_SPEECH_MS = 700;   // minimum sustained speech to commit (drops typing / clicks)

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
  const speechConfirmedRef = useRef(false); // true once RMS exceeded SPEECH_THRESHOLD
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
    speechConfirmedRef.current = false; // reset confirmation for this utterance
    setIsSpeechDetected(true);

    // Commit a chunk every chunkIntervalMs while speaking (low-latency translation).
    // Only commits if speech reached the confirmation threshold.
    chunkTimerRef.current = setInterval(() => {
      if (hasBufferedAudioRef.current && speechConfirmedRef.current) {
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

    // Commit final chunk only if:
    //   1. there is buffered audio
    //   2. speech lasted long enough (not just a click/cough)
    //   3. RMS peaked above the confirmation threshold (not just ambient noise)
    if (
      hasBufferedAudioRef.current &&
      duration >= MIN_SPEECH_MS &&
      speechConfirmedRef.current
    ) {
      hasBufferedAudioRef.current = false;
      onChunkReadyRef.current?.();
    } else {
      hasBufferedAudioRef.current = false;
      onDiscardRef.current?.(); // clear server-side buffer
    }
    speechConfirmedRef.current = false;
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
          // Check if this buffer peaks above the speech confirmation threshold
          if (rms >= SPEECH_THRESHOLD) {
            speechConfirmedRef.current = true;
          }

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
    speechConfirmedRef.current = false;
    speechStartTimeRef.current = null;
    setIsCapturing(false);
    setVolume(0);
    setIsSpeechDetected(false);
  }, []);

  return { isCapturing, volume, isSpeechDetected, start, stop, setIsPlaying };
}
