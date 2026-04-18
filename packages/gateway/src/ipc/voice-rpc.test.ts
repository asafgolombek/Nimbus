import { describe, expect, test } from "bun:test";
import type { VoiceStatus } from "../voice/service.ts";
import type { VoiceRpcContext } from "./voice-rpc.ts";
import { dispatchVoiceRpc, VoiceRpcError } from "./voice-rpc.ts";

function makeFakeService(enabled = true): VoiceRpcContext["voiceService"] {
  return {
    enabled,
    transcribe: async (path: string) => ({ text: `transcribed:${path}`, durationMs: 42 }),
    speak: async (_text: string) => undefined,
    getStatus: async (): Promise<VoiceStatus> => ({
      enabled,
      sttAvailable: true,
      ttsAvailable: true,
      wakeWordActive: false,
    }),
    startWakeWord: () => undefined,
    stopWakeWord: () => undefined,
  } as unknown as VoiceRpcContext["voiceService"];
}

describe("dispatchVoiceRpc", () => {
  test("returns miss for non-voice method", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("llm.listModels", {}, ctx);
    expect(result.kind).toBe("miss");
  });

  test("voice.getStatus returns status object", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("voice.getStatus", {}, ctx);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as VoiceStatus;
      expect(value.enabled).toBe(true);
      expect(value.sttAvailable).toBe(true);
    }
  });

  test("voice.transcribe returns text from STT", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("voice.transcribe", { audioPath: import.meta.path }, ctx);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      const value = result.value as { text: string };
      expect(value.text).toBe(`transcribed:${import.meta.path}`);
    }
  });

  test("voice.transcribe throws VoiceRpcError for missing audioPath param", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    await expect(dispatchVoiceRpc("voice.transcribe", {}, ctx)).rejects.toBeInstanceOf(
      VoiceRpcError,
    );
  });

  test("VoiceRpcError carries rpcCode -32602 for invalid params", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    try {
      await dispatchVoiceRpc("voice.transcribe", {}, ctx);
      throw new Error("expected VoiceRpcError to be thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceRpcError);
      expect((e as VoiceRpcError).rpcCode).toBe(-32602);
    }
  });

  test("voice.speak returns empty result", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    const result = await dispatchVoiceRpc("voice.speak", { text: "Hello" }, ctx);
    expect(result.kind).toBe("hit");
  });

  test("voice.speak throws VoiceRpcError for missing text param", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    await expect(dispatchVoiceRpc("voice.speak", {}, ctx)).rejects.toBeInstanceOf(VoiceRpcError);
  });

  test("voice.startWakeWord and voice.stopWakeWord return empty hit", async () => {
    const ctx: VoiceRpcContext = { voiceService: makeFakeService() };
    expect((await dispatchVoiceRpc("voice.startWakeWord", {}, ctx)).kind).toBe("hit");
    expect((await dispatchVoiceRpc("voice.stopWakeWord", {}, ctx)).kind).toBe("hit");
  });
});
