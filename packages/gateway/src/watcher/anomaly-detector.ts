/**
 * Phase 3 stub — rolling baseline + z-score style deviation (no automated remediation; HITL remains mandatory).
 * Future: feed from post-sync telemetry / embedding norms (Phase 4 alignment).
 */

export type AnomalyNotification = {
  readonly seriesId: string;
  readonly value: number;
  readonly score: number;
  readonly atMs: number;
};

export type AnomalyNotifyFn = (event: AnomalyNotification) => void;

const DEFAULT_WINDOW = 64;

/** Simple rolling window mean/std deviation for scalar signals (e.g. sync duration, item counts). */
export class AnomalyDetectorStub {
  private readonly windowSize: number;
  private readonly series = new Map<string, number[]>();
  private notify: AnomalyNotifyFn | undefined;

  constructor(options?: { windowSize?: number; onNotify?: AnomalyNotifyFn }) {
    this.windowSize = options?.windowSize ?? DEFAULT_WINDOW;
    this.notify = options?.onNotify;
  }

  setNotifyHandler(handler: AnomalyNotifyFn | undefined): void {
    this.notify = handler;
  }

  recordSample(seriesId: string, value: number, atMs: number): number {
    const key = seriesId.trim();
    if (key === "") {
      return 0;
    }
    const prev = this.series.get(key) ?? [];
    const next = [...prev, value];
    while (next.length > this.windowSize) {
      next.shift();
    }
    this.series.set(key, next);
    const score = this.deviationScore(key, value);
    if (score >= 3 && next.length >= 4 && this.notify !== undefined) {
      this.notify({ seriesId: key, value, score, atMs });
    }
    return score;
  }

  deviationScore(seriesId: string, value: number): number {
    const xs = this.series.get(seriesId) ?? [];
    if (xs.length < 3) {
      return 0;
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    const sd = Math.sqrt(variance);
    if (sd < 1e-9) {
      return 0;
    }
    return Math.abs(value - mean) / sd;
  }
}
