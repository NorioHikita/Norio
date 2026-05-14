import { useCallback, useState } from 'react';
import type { SessionConfig } from '../types/realtime';
import { useInterpreterSessions } from '../hooks/useInterpreterSessions';
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

  const sessions = useInterpreterSessions();
  const capture = useAudioCapture();
  const player = useAudioPlayer(
    useCallback((playing: boolean) => capture.setIsPlaying(playing), [capture]),
  );

  const handleStart = useCallback(async () => {
    try {
      await capture.start(
        (chunk) => sessions.sendAudioChunk(chunk),
        () => sessions.commitAndTranslate(),
        config.chunkIntervalMs,
      );
      sessions.connect(config, (chunk) => player.playChunk(chunk));
      setIsRunning(true);
    } catch {
      alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
  }, [capture, sessions, config, player]);

  const handleStop = useCallback(() => {
    capture.stop();
    player.stopAll();
    sessions.disconnect();
    setIsRunning(false);
  }, [capture, player, sessions]);

  const speakerA = config.speakerA;
  const speakerB = config.speakerB;

  const statusLabel = (() => {
    if (!isRunning) return '停止中';
    if (!sessions.isConnected) return '接続中…';
    if (capture.isSpeechDetected) return '発話検出中 — 通訳中';
    return '待機中 — 話しかけてください';
  })();

  const statusClass = (() => {
    if (!isRunning || !sessions.isConnected) return 'status-idle';
    if (capture.isSpeechDetected) return 'status-speaking';
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

      <div className="visualizer-section">
        <AudioVisualizer
          volume={capture.volume}
          isActive={isRunning && capture.isSpeechDetected}
          color={capture.isSpeechDetected ? '#4ade80' : '#4f6ef7'}
        />

        {isRunning && sessions.isConnected && (
          <div className="speaker-indicators">
            <div className="speaker-indicator speaker-indicator-a">
              <span className="si-flag">
                {speakerA.language === 'ja' ? '🇯🇵' : '🇺🇸'}
              </span>
              <span className="si-name">{speakerA.name}</span>
              <span className="si-arrow">→</span>
              <span className="si-flag">
                {speakerA.language === 'ja' ? '🇺🇸' : '🇯🇵'}
              </span>
            </div>
            <div className="si-sep">|</div>
            <div className="speaker-indicator speaker-indicator-b">
              <span className="si-flag">
                {speakerB.language === 'ja' ? '🇯🇵' : '🇺🇸'}
              </span>
              <span className="si-name">{speakerB.name}</span>
              <span className="si-arrow">→</span>
              <span className="si-flag">
                {speakerB.language === 'ja' ? '🇺🇸' : '🇯🇵'}
              </span>
            </div>
          </div>
        )}

        <div className="visualizer-hint">
          {isRunning && sessions.isConnected
            ? 'マイクに向かって話しかけてください — 自動で言語を判別します'
            : isRunning
            ? '接続中…'
            : '通訳を開始してください'}
        </div>
      </div>

      <div className="transcript-section">
        <TranscriptDisplay
          segments={sessions.transcripts}
          onClear={sessions.clearTranscripts}
        />
      </div>

      <footer className="panel-footer">
        <div className="footer-info">
          <span className="info-chip">🤖 自動言語判別</span>
          <span className="info-chip">⚡ 発話直後に通訳開始</span>
          <span className="info-chip">🔄 双方向・ボタンなし</span>
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
