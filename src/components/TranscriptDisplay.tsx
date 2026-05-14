import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '../types/realtime';

interface Props {
  segments: TranscriptSegment[];
  onClear: () => void;
}

function Cursor() {
  return <span className="cursor">▋</span>;
}

const OUTPUT_FLAG: Record<string, string> = {
  'ja-en': '🇺🇸',  // input was Japanese, output is English
  'en-ja': '🇯🇵',  // input was English, output is Japanese
};

export function TranscriptDisplay({ segments, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  if (segments.length === 0) {
    return (
      <div className="transcript-empty">
        <p>通訳を開始して話しかけると、ここに翻訳結果が表示されます</p>
        <p className="transcript-empty-sub">
          発話から約1〜2秒で通訳音声が流れ始めます
        </p>
      </div>
    );
  }

  return (
    <div className="transcript-list">
      <div className="transcript-actions">
        <button className="btn-ghost btn-sm" onClick={onClear}>
          履歴を消去
        </button>
      </div>

      {segments.map((seg) => {
        const isA = seg.speaker === 'A';
        const outputFlag = OUTPUT_FLAG[seg.direction] ?? '🌐';
        return (
          <div
            key={seg.id}
            className={`segment ${isA ? 'segment-a' : 'segment-b'}`}
          >
            <div className="segment-time">
              {seg.timestamp.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
              <span
                className="segment-speaker-badge"
                style={{ color: isA ? '#4f6ef7' : '#34d399' }}
              >
                {seg.inputLabel}
              </span>
            </div>

            <div className="segment-row segment-translation">
              <div
                className="segment-label"
                style={{ color: isA ? '#60a5fa' : '#34d399' }}
              >
                <span>{outputFlag}</span>
                <span>{seg.outputLabel}</span>
              </div>
              <div className="segment-text">
                {seg.outputText || (
                  <span className="placeholder">通訳中…</span>
                )}
                {seg.outputStreaming && <Cursor />}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
