import type { ProfileManager } from "../config/profiles.ts";

export class ProfileRpcError extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "ProfileRpcError";
    this.rpcCode = rpcCode;
  }
}

export type ProfileRpcContext = {
  manager: ProfileManager;
  notify?: (method: string, params: unknown) => void;
};

export async function dispatchProfileRpc(
  method: string,
  params: unknown,
  ctx: ProfileRpcContext,
): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
  switch (method) {
    case "profile.list": {
      const profiles = await ctx.manager.list();
      const active = (await ctx.manager.getActive()) ?? null;
      return { kind: "hit", value: { profiles, active } };
    }
    case "profile.create": {
      const p = params as { name?: unknown } | null;
      if (p === null || typeof p.name !== "string") {
        throw new ProfileRpcError(-32602, "profile.create requires name");
      }
      await ctx.manager.create(p.name);
      return { kind: "hit", value: { name: p.name } };
    }
    case "profile.switch": {
      const p = params as { name?: unknown } | null;
      if (p === null || typeof p.name !== "string") {
        throw new ProfileRpcError(-32602, "profile.switch requires name");
      }
      await ctx.manager.switchTo(p.name);
      ctx.notify?.("profile.switched", { name: p.name });
      return { kind: "hit", value: { active: p.name } };
    }
    case "profile.delete": {
      const p = params as { name?: unknown } | null;
      if (p === null || typeof p.name !== "string") {
        throw new ProfileRpcError(-32602, "profile.delete requires name");
      }
      await ctx.manager.delete(p.name);
      return { kind: "hit", value: { deleted: p.name } };
    }
    default:
      return { kind: "miss" };
  }
}
