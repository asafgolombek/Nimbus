import { describe, expect, test } from "bun:test";
import type { SttProvider, SttResult } from "./types.ts";
import { WakeWordDetectorImpl } from "./wake-word.ts";

function makeFakeStt(transcripts: string[]): SttProvider {
  let callCount = 0;
  return {
    isAvailable: async () => true,
    transcribe: async (_path: string): Promise<SttResult> => {
      const text = transcripts[callCount % transcripts.length] ?? "";
      callCount++;
      return { text, durationMs: 10 };
    },
  };
}

describe("WakeWordDetectorImpl", () => {
  test("isRunning is false initially", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => import.meta.path,
    });
    expect(det.isRunning).toBe(false);
  });

  test("start sets isRunning to true, stop sets it to false", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => import.meta.path,
    });
    det.start();
    expect(det.isRunning).toBe(true);
    det.stop();
    expect(det.isRunning).toBe(false);
  });

  test("start is idempotent", () => {
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([]),
      wakeWord: "hey nimbus",
      recordAudio: async () => import.meta.path,
    });
    det.start();
    det.start();
    expect(det.isRunning).toBe(true);
    det.stop();
  });

  test("fires onDetected when transcript contains wake word (case-insensitive)", async () => {
    const events: string[] = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt(["Hey Nimbus, what time is it?"]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      recordAudio: async () => import.meta.path,
      isChunkSilent: async () => false,
    });
    det.onDetected = (evt) => {
      events.push(evt.transcript);
      det.stop();
    };
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toContain("Hey Nimbus");
  });

  test("does not fire onDetected when transcript does not contain wake word", async () => {
    const events: string[] = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt(["The weather is nice today."]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      maxPolls: 3,
      recordAudio: async () => import.meta.path,
      isChunkSilent: async () => false,
    });
    det.onDetected = (evt) => events.push(evt.transcript);
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    det.stop();
    expect(events).toHaveLength(0);
  });

  test("onMicrophoneStateChange fires active=true before recording and active=false after", async () => {
    const states: Array<{ active: boolean; source: string }> = [];
    const det = new WakeWordDetectorImpl({
      stt: makeFakeStt([""]),
      wakeWord: "hey nimbus",
      pollIntervalMs: 10,
      maxPolls: 1,
      recordAudio: async () => import.meta.path,
      isChunkSilent: async () => true,
    });
    det.onMicrophoneStateChange = (evt) => states.push({ active: evt.active, source: evt.source });
    det.start();
    await new Promise((r) => setTimeout(r, 100));
    det.stop();
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[0]).toEqual({ active: true, source: "wake-word" });
    expect(states.at(-1)).toEqual({ active: false, source: "wake-word" });
  });
});
