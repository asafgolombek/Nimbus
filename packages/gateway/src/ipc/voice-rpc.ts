import type { VoiceService } from "../voice/service.ts";

export class VoiceRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "VoiceRpcError";
  }
}

export type VoiceRpcContext = {
  voiceService: VoiceService;
};

type RpcResult = { kind: "hit"; value: unknown } | { kind: "miss" };

function expectString(params: unknown, key: string): string {
  if (
    params === null ||
    typeof params !== "object" ||
    !(key in (params as Record<string, unknown>)) ||
    typeof (params as Record<string, unknown>)[key] !== "string"
  ) {
    throw new VoiceRpcError(-32602, `Missing or invalid param: ${key}`);
  }
  return (params as Record<string, string>)[key]!;
}

export async function dispatchVoiceRpc(
  method: string,
  params: unknown,
  ctx: VoiceRpcContext,
): Promise<RpcResult> {
  if (!method.startsWith("voice.")) return { kind: "miss" };

  switch (method) {
    case "voice.getStatus": {
      const status = await ctx.voiceService.getStatus();
      return { kind: "hit", value: status };
    }
    case "voice.transcribe": {
      const audioPath = expectString(params, "audioPath");
      try {
        const result = await ctx.voiceService.transcribe(audioPath);
        return { kind: "hit", value: result };
      } catch (e) {
        throw new VoiceRpcError(-32603, e instanceof Error ? e.message : String(e));
      }
    }
    case "voice.speak": {
      const text = expectString(params, "text");
      try {
        await ctx.voiceService.speak(text);
        return { kind: "hit", value: {} };
      } catch (e) {
        throw new VoiceRpcError(-32603, e instanceof Error ? e.message : String(e));
      }
    }
    case "voice.startWakeWord": {
      ctx.voiceService.startWakeWord();
      return { kind: "hit", value: {} };
    }
    case "voice.stopWakeWord": {
      ctx.voiceService.stopWakeWord();
      return { kind: "hit", value: {} };
    }
    default:
      return { kind: "miss" };
  }
}
