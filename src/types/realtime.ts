export type Language = 'ja' | 'en';
export type SpeakerId = 'A' | 'B';
export type VoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export type Direction = 'ja-en' | 'en-ja';

export interface SpeakerConfig {
  id: SpeakerId;
  name: string;
  language: Language;
}

export interface SessionConfig {
  apiKey: string;
  voice: VoiceId;
  speakerA: SpeakerConfig;
  speakerB: SpeakerConfig;
  chunkIntervalMs: number;
}

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerId;
  direction: Direction;
  inputLabel: string;   // e.g. "田中さん（日本語）"
  outputLabel: string;  // e.g. "English"
  outputText: string;
  outputStreaming: boolean;
  timestamp: Date;
}
