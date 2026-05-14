import { useState } from 'react';
import type { SessionConfig, VoiceId, Language, SpeakerConfig } from '../types/realtime';

const VOICES: { id: VoiceId; label: string }[] = [
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'alloy', label: 'Alloy' },
  { id: 'nova', label: 'Nova' },
  { id: 'echo', label: 'Echo' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'fable', label: 'Fable' },
];

const LANGUAGES: { id: Language; label: string; flag: string }[] = [
  { id: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'en', label: 'English', flag: '🇺🇸' },
];

const SAVED_KEY = 'realtime_api_key';

interface SpeakerInputProps {
  label: string;
  color: string;
  config: SpeakerConfig;
  onChange: (c: SpeakerConfig) => void;
}

function SpeakerInput({ label, color, config, onChange }: SpeakerInputProps) {
  return (
    <div className="speaker-input" style={{ borderColor: color }}>
      <div className="speaker-input-header" style={{ color }}>
        {label}
      </div>
      <div className="form-group">
        <label className="form-label">名前</label>
        <input
          type="text"
          className="form-input"
          placeholder="例: 田中さん"
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label">話す言語</label>
        <div className="lang-grid">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              type="button"
              className={`lang-btn ${config.language === lang.id ? 'active' : ''}`}
              style={config.language === lang.id ? { borderColor: color, color } : {}}
              onClick={() => onChange({ ...config, language: lang.id })}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  onSubmit: (config: SessionConfig) => void;
}

export function ApiKeySetup({ onSubmit }: Props) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(SAVED_KEY) ?? '');
  const [voice, setVoice] = useState<VoiceId>('shimmer');
  const [chunkIntervalMs, setChunkIntervalMs] = useState(1500);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [speakerA, setSpeakerA] = useState<SpeakerConfig>({
    id: 'A',
    name: '話者A',
    language: 'ja',
  });
  const [speakerB, setSpeakerB] = useState<SpeakerConfig>({
    id: 'B',
    name: 'Speaker B',
    language: 'en',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    if (speakerA.language === speakerB.language) {
      alert('話者AとBの言語が同じです。異なる言語を設定してください。');
      return;
    }
    localStorage.setItem(SAVED_KEY, apiKey.trim());
    onSubmit({
      apiKey: apiKey.trim(),
      voice,
      speakerA,
      speakerB,
      chunkIntervalMs,
    });
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
        <p className="setup-subtitle">日英・英日 リアルタイム同時通訳</p>

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
            </p>
          </div>

          <div className="speakers-row">
            <SpeakerInput
              label="話者 A"
              color="#4f6ef7"
              config={speakerA}
              onChange={setSpeakerA}
            />
            <div className="speakers-divider">⇄</div>
            <SpeakerInput
              label="話者 B"
              color="#34d399"
              config={speakerB}
              onChange={setSpeakerB}
            />
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
                  通訳チャンク間隔: {chunkIntervalMs}ms
                  <span className="form-hint-inline">（短いほど通訳開始が速い、最小1000ms推奨）</span>
                </label>
                <input
                  type="range"
                  min={800}
                  max={3000}
                  step={100}
                  value={chunkIntervalMs}
                  onChange={(e) => setChunkIntervalMs(Number(e.target.value))}
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
