import { useRef, useCallback, useState } from 'react';
import { float32ToPCM16, pcm16ToBase64, calculateRMS, SAMPLE_RATE } from '../utils/audioUtils';

const BUFFER_SIZE = 2048;

export function useAudioCapture() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [volume, setVolume] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onChunkRef = useRef<((chunk: string) => void) | null>(null);
  const isPlayingRef = useRef(false);

  const setIsPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
  }, []);

  const start = useCallback(async (onChunk: (chunk: string) => void) => {
    onChunkRef.current = onChunk;

    try {
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
        if (isPlayingRef.current) return; // suppress mic during playback to prevent echo

        const inputData = event.inputBuffer.getChannelData(0);
        setVolume(calculateRMS(inputData));

        const pcm16 = float32ToPCM16(inputData);
        const base64 = pcm16ToBase64(pcm16);
        onChunkRef.current?.(base64);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsCapturing(true);
    } catch (err) {
      console.error('Microphone access failed:', err);
      throw err;
    }
  }, []);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    setIsCapturing(false);
    setVolume(0);
  }, []);

  return { isCapturing, volume, start, stop, setIsPlaying };
}
