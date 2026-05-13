import { useCallback, useState } from 'react';
import type { SessionConfig } from '../types/realtime';
import { useRealtimeSession } from '../hooks/useRealtimeSession';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { AudioVisualizer } from './AudioVisualizer';
import { TranscriptDisplay } from './TranscriptDisplay';

interface Props {
  config: SessionConfig;
  onReset: () => void;
}

export function InterpreterPanel({ config, onReset }: Props) {
  const [isRunning, setIsRunning] = useState(false);

  const session = useRealtimeSession();
  const capture = useAudioCapture();

  const player = useAudioPlayer(
    useCallback(
      (playing: boolean) => capture.setIsPlaying(playing),
      [capture],
    ),
  );

  const handleStart = useCallback(async () => {
    try {
      await capture.start((chunk) => session.sendAudioChunk(chunk));
      session.connect(config, (chunk) => player.playChunk(chunk));
      setIsRunning(true);
    } catch (err) {
      console.error('Failed to start:', err);
      alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
  }, [capture, session, config, player]);

  const handleStop = useCallback(() => {
    capture.stop();
    player.stopAll();
    session.disconnect();
    setIsRunning(false);
  }, [capture, player, session]);

  const statusLabel = (() => {
    if (!isRunning) return '停止中';
    if (session.isConnecting) return '接続中…';
    if (!session.isConnected) return '切断中';
    if (session.isSpeaking) return '発話検出中';
    if (session.isTranslating) return '通訳中';
    return '待機中';
  })();

  const statusClass = (() => {
    if (!isRunning || !session.isConnected) return 'status-idle';
    if (session.isSpeaking) return 'status-speaking';
    if (session.isTranslating) return 'status-translating';
    return 'status-ready';
  })();

  return (
    <div className="panel">
      <header className="panel-header">
        <div className="header-left">
          <h1 className="app-title">
            <span className="flag">🇯🇵</span>
            <span className="title-sep">⇄</span>
            <span className="flag">🇺🇸</span>
            <span className="title-text">Realtime Interpreter</span>
          </h1>
        </div>
        <div className="header-right">
          <div className={`status-badge ${statusClass}`}>
            <span className="status-dot" />
            {statusLabel}
          </div>
          <button className="btn-ghost btn-sm" onClick={onReset}>
            設定
          </button>
        </div>
      </header>

      {session.error && (
        <div className="error-banner">
          <span>⚠️ {session.error}</span>
          <button className="btn-ghost btn-xs" onClick={() => session.clearTranscripts()}>
            ✕
          </button>
        </div>
      )}

      <div className="visualizer-section">
        <AudioVisualizer
          volume={capture.volume}
          isActive={isRunning && session.isSpeaking}
          color={session.isSpeaking ? '#4ade80' : '#4f6ef7'}
        />
        <div className="visualizer-hint">
          {isRunning && session.isConnected
            ? '日本語または英語で話してください'
            : '通訳を開始してください'}
        </div>
      </div>

      <div className="transcript-section">
        <TranscriptDisplay
          segments={session.transcripts}
          onClear={session.clearTranscripts}
        />
      </div>

      <footer className="panel-footer">
        <div className="footer-info">
          <span className="info-chip">🎙️ 自動言語検出</span>
          <span className="info-chip">⚡ 低遅延通訳</span>
          <span className="info-chip">🔄 双方向対応</span>
        </div>

        {!isRunning ? (
          <button className="btn-primary btn-large" onClick={handleStart}>
            ▶ 通訳を開始
          </button>
        ) : (
          <button className="btn-danger btn-large" onClick={handleStop}>
            ■ 停止
          </button>
        )}
      </footer>
    </div>
  );
}
