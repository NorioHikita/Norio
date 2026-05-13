import { useEffect, useRef } from 'react';

interface Props {
  volume: number;
  isActive: boolean;
  color?: string;
}

const BAR_COUNT = 20;

export function AudioVisualizer({ volume, isActive, color = '#4f6ef7' }: Props) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const frameRef = useRef<number>(0);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!isActive) {
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = '4px';
      });
      return;
    }

    const animate = () => {
      const v = volumeRef.current;
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const center = (BAR_COUNT - 1) / 2;
        const dist = Math.abs(i - center) / center;
        const noise = (Math.random() - 0.5) * 0.4;
        const envelope = 1 - dist * 0.6;
        const height = Math.max(4, (v * 120 + noise * 20) * envelope);
        bar.style.height = `${Math.min(height, 48)}px`;
      });
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isActive]);

  return (
    <div className="visualizer">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="visualizer-bar"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
