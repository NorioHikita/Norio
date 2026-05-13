import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '../types/realtime';

interface Props {
  segments: TranscriptSegment[];
  onClear: () => void;
}

const DIR_LABELS: Record<string, { from: string; to: string; fromFlag: string; toFlag: string }> = {
  'ja-en': { from: '日本語', to: 'English', fromFlag: '🇯🇵', toFlag: '🇺🇸' },
  'en-ja': { from: 'English', to: '日本語', fromFlag: '🇺🇸', toFlag: '🇯🇵' },
  unknown: { from: '検出中…', to: '通訳', fromFlag: '🎙️', toFlag: '🔊' },
};

function Cursor() {
  return <span className="cursor">▋</span>;
}

export function TranscriptDisplay({ segments, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  if (segments.length === 0) {
    return (
      <div className="transcript-empty">
        <p>マイクに向かって話しかけると、ここに通訳結果が表示されます</p>
        <p className="transcript-empty-sub">日本語・英語どちらでも自動検出します</p>
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
        const labels = DIR_LABELS[seg.direction] ?? DIR_LABELS.unknown;
        return (
          <div key={seg.id} className="segment">
            <div className="segment-time">
              {seg.timestamp.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>

            <div className="segment-row segment-original">
              <div className="segment-label">
                <span className="segment-flag">{labels.fromFlag}</span>
                <span>{labels.from}</span>
              </div>
              <div className="segment-text">
                {seg.inputText || (seg.inputStreaming ? <span className="placeholder">認識中…</span> : '—')}
                {seg.inputStreaming && !seg.inputText && <Cursor />}
              </div>
            </div>

            <div className="segment-row segment-translation">
              <div className="segment-label">
                <span className="segment-flag">{labels.toFlag}</span>
                <span>{labels.to}</span>
              </div>
              <div className="segment-text">
                {seg.outputText || (seg.outputStreaming ? <span className="placeholder">通訳中…</span> : '—')}
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
