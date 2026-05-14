import { useCallback, useState } from 'react';
import type { SessionConfig, SpeakerId } from '../types/realtime';
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
  const [activeSpeaker, setActiveSpeaker] = useState<SpeakerId | null>(null);

  const sessions = useInterpreterSessions();
  const capture = useAudioCapture();

  const player = useAudioPlayer(
    useCallback((playing: boolean) => capture.setIsPlaying(playing), [capture]),
  );

  // Keep activeSpeaker accessible in stable audio callbacks
  const activeSpeakerStableRef = { current: activeSpeaker };

  const handleStart = useCallback(async () => {
    try {
      await capture.start(
        (chunk) => {
          const spk = activeSpeakerStableRef.current;
          if (spk) sessions.sendAudioChunk(chunk, spk);
        },
        () => {
          const spk = activeSpeakerStableRef.current;
          if (spk) sessions.commitAndTranslate(spk);
        },
        config.chunkIntervalMs,
      );
      sessions.connect(config, (chunk) => player.playChunk(chunk));
      setIsRunning(true);
    } catch {
      alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture, sessions, config, player]);

  const handleStop = useCallback(() => {
    capture.stop();
    player.stopAll();
    sessions.disconnect();
    setActiveSpeaker(null);
    setIsRunning(false);
  }, [capture, player, sessions]);

  const speakerA = config.speakerA;
  const speakerB = config.speakerB;

  const statusLabel = (() => {
    if (!isRunning) return '停止中';
    if (!sessions.isConnected) return '接続中…';
    if (activeSpeaker === 'A' && capture.isSpeechDetected) return `${speakerA.name} 発話中`;
    if (activeSpeaker === 'B' && capture.isSpeechDetected) return `${speakerB.name} 発話中`;
    if (activeSpeaker) return `${activeSpeaker === 'A' ? speakerA.name : speakerB.name} 待機中`;
    return '話者を選択してください';
  })();

  const statusClass = (() => {
    if (!isRunning || !sessions.isConnected) return 'status-idle';
    if (capture.isSpeechDetected) return activeSpeaker === 'A' ? 'status-speaker-a' : 'status-speaker-b';
    if (activeSpeaker) return 'status-ready';
    return 'status-idle';
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
          color={activeSpeaker === 'A' ? '#4f6ef7' : activeSpeaker === 'B' ? '#34d399' : '#4f6ef7'}
        />
        <div className="visualizer-hint">
          {isRunning && sessions.isConnected
            ? '話す人のボタンを押してください'
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
        {isRunning && sessions.isConnected ? (
          <div className="speaker-controls">
            <button
              className={`speaker-btn speaker-btn-a ${activeSpeaker === 'A' ? 'active' : ''}`}
              onClick={() => setActiveSpeaker((s) => (s === 'A' ? null : 'A'))}
            >
              <span className="speaker-btn-label">A</span>
              <span className="speaker-btn-name">{speakerA.name}</span>
              <span className="speaker-btn-lang">
                {speakerA.language === 'ja' ? '🇯🇵 日本語' : '🇺🇸 English'}
                {' → '}
                {speakerA.language === 'ja' ? '🇺🇸 English' : '🇯🇵 日本語'}
              </span>
              {activeSpeaker === 'A' && (
                <span className="speaker-btn-active-dot" />
              )}
            </button>

            <button
              className={`speaker-btn speaker-btn-b ${activeSpeaker === 'B' ? 'active' : ''}`}
              onClick={() => setActiveSpeaker((s) => (s === 'B' ? null : 'B'))}
            >
              <span className="speaker-btn-label">B</span>
              <span className="speaker-btn-name">{speakerB.name}</span>
              <span className="speaker-btn-lang">
                {speakerB.language === 'ja' ? '🇯🇵 日本語' : '🇺🇸 English'}
                {' → '}
                {speakerB.language === 'ja' ? '🇺🇸 English' : '🇯🇵 日本語'}
              </span>
              {activeSpeaker === 'B' && (
                <span className="speaker-btn-active-dot" />
              )}
            </button>

            <button className="btn-danger btn-stop-inline" onClick={handleStop}>
              ■ 停止
            </button>
          </div>
        ) : (
          <div className="footer-start-row">
            <div className="footer-info">
              <span className="info-chip">⚡ チャンク同時通訳</span>
              <span className="info-chip">🚫 言語検出なし</span>
              <span className="info-chip">🔄 双方向対応</span>
            </div>
            {!isRunning ? (
              <button className="btn-primary btn-large" onClick={handleStart}>
                ▶ 通訳を開始
              </button>
            ) : (
              <span className="connecting-msg">接続中…</span>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
