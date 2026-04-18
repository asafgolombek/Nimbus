export type SttResult = {
  text: string;
  /** Transcription duration in ms (wall-clock). */
  durationMs: number;
  /** Language detected by Whisper, e.g. "en". */
  language?: string;
};

export interface SttProvider {
  /** Returns true if the STT binary is available and executable. */
  isAvailable(): Promise<boolean>;
  /**
   * Transcribe a WAV/MP3 audio file to text.
   * @param audioPath Absolute path to the audio file.
   */
  transcribe(audioPath: string): Promise<SttResult>;
}

export interface TtsProvider {
  /** Returns true if the TTS engine is available on this platform. */
  isAvailable(): Promise<boolean>;
  /**
   * Speak the given text aloud and resolve when playback is complete.
   * Text is sanitised before passing to the OS — never passed via shell expansion.
   */
  speak(text: string): Promise<void>;
}

export type WakeWordEvent = {
  /** The phrase that triggered detection (full transcript of the triggering chunk). */
  transcript: string;
  detectedAt: number;
};

export type MicrophoneStateEvent = {
  /** True when the microphone is being recorded; false when released. */
  active: boolean;
  /** Why the microphone is hot: wake-word polling, or a caller-initiated transcription. */
  source: "wake-word" | "transcribe";
  changedAt: number;
};

/**
 * The interface is provider-agnostic: today implemented by `WakeWordDetectorImpl`
 * (Whisper + VAD polling), but can be swapped for a dedicated engine
 * (Porcupine, openWakeWord) without any change to `VoiceService` or IPC handlers.
 */
export interface WakeWordDetector {
  /** Start polling for the wake word. No-op if already running. */
  start(): void;
  /** Stop polling and release audio resources. No-op if already stopped. */
  stop(): void;
  onDetected: ((event: WakeWordEvent) => void) | undefined;
  /** Fires whenever the microphone opens or closes inside the detector loop. */
  onMicrophoneStateChange: ((event: MicrophoneStateEvent) => void) | undefined;
  readonly isRunning: boolean;
}
