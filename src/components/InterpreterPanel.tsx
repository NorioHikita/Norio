import { useCallback, useState } from 'react';
import type { SessionConfig } from '../types/realtime';
import { useInterpreterSession } from '../hooks/useInterpreterSession';
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

  const session = useInterpreterSession();
  const capture = useAudioCapture();
  const player = useAudioPlayer(
    useCallback((playing: boolean) => capture.setIsPlaying(playing), [capture]),
  );

  const handleStart = useCallback(async () => {
    try {
      session.connect(config, (chunk) => player.playChunk(chunk));
      await capture.start(
        (chunk) => session.sendAudioChunk(chunk),
        () => session.commitAndTranslate(),
        () => session.clearAudioBuffer(),
        config.chunkIntervalMs,
      );
      setIsRunning(true);
    } catch {
      session.disconnect();
      alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
  }, [capture, session, config, player]);

  const handleStop = useCallback(() => {
    capture.stop();
    player.stopAll();
    session.disconnect();
    setIsRunning(false);
  }, [capture, player, session]);

  const speakerA = config.speakerA;
  const speakerB = config.speakerB;

  const statusLabel = (() => {
    if (!isRunning) return '停止中';
    if (!session.isConnected) return '接続中…';
    if (capture.isSpeechDetected) return '発話検出中 — 通訳中';
    return '待機中 — 話しかけてください';
  })();

  const statusClass = (() => {
    if (!isRunning || !session.isConnected) return 'status-idle';
    if (capture.isSpeechDetected) return 'status-speaking';
    return 'status-ready';
  })();

  const flagFor = (lang: 'ja' | 'en') => (lang === 'ja' ? '🇯🇵' : '🇺🇸');

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

        {isRunning && session.isConnected && (
          <div className="speaker-indicators">
            <div className="speaker-indicator speaker-indicator-a">
              <span className="si-flag">{flagFor(speakerA.language)}</span>
              <span className="si-name">{speakerA.name}</span>
              <span className="si-arrow">→</span>
              <span className="si-flag">{flagFor(speakerA.language === 'ja' ? 'en' : 'ja')}</span>
            </div>
            <div className="si-sep">|</div>
            <div className="speaker-indicator speaker-indicator-b">
              <span className="si-flag">{flagFor(speakerB.language)}</span>
              <span className="si-name">{speakerB.name}</span>
              <span className="si-arrow">→</span>
              <span className="si-flag">{flagFor(speakerB.language === 'ja' ? 'en' : 'ja')}</span>
            </div>
          </div>
        )}

        <div className="visualizer-hint">
          {isRunning && session.isConnected
            ? 'マイクに向かって話しかけてください — 自動で言語を判別します'
            : isRunning
            ? '接続中…'
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
