import { useState } from 'react';
import type { SessionConfig, VoiceId } from '../types/realtime';

interface Props {
  onSubmit: (config: SessionConfig) => void;
}

const VOICES: { id: VoiceId; label: string }[] = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'nova', label: 'Nova' },
  { id: 'echo', label: 'Echo' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'fable', label: 'Fable' },
];

const SAVED_KEY = 'realtime_api_key';

export function ApiKeySetup({ onSubmit }: Props) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(SAVED_KEY) ?? '');
  const [voice, setVoice] = useState<VoiceId>('shimmer');
  const [silenceDurationMs, setSilenceDurationMs] = useState(200);
  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    localStorage.setItem(SAVED_KEY, apiKey.trim());
    onSubmit({ apiKey: apiKey.trim(), voice, silenceDurationMs, vadThreshold });
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <div className="setup-logo">
          <span className="setup-flag">🇯🇵</span>
          <span className="setup-arrow">⇄</span>
          <span className="setup-flag">🇺🇸</span>
        </div>
        <h1 className="setup-title">Realtime Interpreter</h1>
        <p className="setup-subtitle">
          日英・英日 リアルタイム同時通訳
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label className="form-label">OpenAI API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              required
            />
            <p className="form-hint">
              APIキーはブラウザのlocalStorageにのみ保存されます。
              本番環境ではバックエンドプロキシを使用してください。
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">通訳音声</label>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`voice-btn ${voice === v.id ? 'active' : ''}`}
                  onClick={() => setVoice(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setShowAdvanced((p) => !p)}
          >
            {showAdvanced ? '▲' : '▼'} 詳細設定
          </button>

          {showAdvanced && (
            <div className="advanced-panel">
              <div className="form-group">
                <label className="form-label">
                  無音検出閾値: {silenceDurationMs}ms
                  <span className="form-hint-inline">（短いほど素早く翻訳開始）</span>
                </label>
                <input
                  type="range"
                  min={100}
                  max={800}
                  step={50}
                  value={silenceDurationMs}
                  onChange={(e) => setSilenceDurationMs(Number(e.target.value))}
                  className="form-range"
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  VAD感度: {vadThreshold.toFixed(1)}
                  <span className="form-hint-inline">（高いほど大きな声に反応）</span>
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={0.9}
                  step={0.1}
                  value={vadThreshold}
                  onChange={(e) => setVadThreshold(Number(e.target.value))}
                  className="form-range"
                />
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary btn-full">
            通訳を開始する
          </button>
        </form>
      </div>
    </div>
  );
}
