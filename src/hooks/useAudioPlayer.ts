import { useRef, useCallback } from 'react';
import { base64ToFloat32, SAMPLE_RATE } from '../utils/audioUtils';

// Small lookahead prevents gap between scheduled buffers
const SCHEDULE_AHEAD = 0.05;

export function useAudioPlayer(onPlayingChange?: (playing: boolean) => void) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayAtRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const getCtx = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    return audioContextRef.current;
  }, []);

  const playChunk = useCallback(
    (base64Audio: string) => {
      const ctx = getCtx();
      const float32 = base64ToFloat32(base64Audio);
      if (float32.length === 0) return;

      const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startAt = Math.max(now + SCHEDULE_AHEAD, nextPlayAtRef.current);
      source.start(startAt);
      nextPlayAtRef.current = startAt + buffer.duration;

      activeSourcesRef.current.push(source);
      onPlayingChange?.(true);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
        if (activeSourcesRef.current.length === 0) {
          onPlayingChange?.(false);
        }
      };
    },
    [getCtx, onPlayingChange],
  );

  const stopAll = useCallback(() => {
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    });
    activeSourcesRef.current = [];
    nextPlayAtRef.current = 0;
    onPlayingChange?.(false);
  }, [onPlayingChange]);

  const reset = useCallback(() => {
    nextPlayAtRef.current = 0;
  }, []);

  return { playChunk, stopAll, reset };
}
