export type Direction = 'ja-en' | 'en-ja' | 'unknown';

export interface TranscriptSegment {
  id: string;
  itemId: string | null;
  direction: Direction;
  inputText: string;
  outputText: string;
  inputStreaming: boolean;
  outputStreaming: boolean;
  timestamp: Date;
}

export interface SessionStatus {
  connected: boolean;
  connecting: boolean;
  speaking: boolean;
  translating: boolean;
  error: string | null;
}

export type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface SessionConfig {
  apiKey: string;
  voice: VoiceId;
  silenceDurationMs: number;
  vadThreshold: number;
}
