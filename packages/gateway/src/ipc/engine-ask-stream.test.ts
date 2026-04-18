import { describe, expect, test } from "bun:test";
import type { NimbusVault } from "../vault/nimbus-vault.ts";
import type { AgentInvokeHandler } from "./agent-invoke.ts";
import type { CreateIpcServerOptions } from "./server.ts";
import { createIpcServer } from "./server.ts";

function makeStubVault(): NimbusVault {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => {
      store.delete(k);
    },
    listKeys: async () => [...store.keys()],
  };
}

function makeServerOpts(extra: Partial<CreateIpcServerOptions> = {}): CreateIpcServerOptions {
  return {
    listenPath: "/tmp/test-ws1.sock",
    vault: makeStubVault(),
    version: "0.0.0-test",
    ...extra,
  };
}

describe("engine.askStream", () => {
  test("is not exposed without an agentInvoke handler", async () => {
    const server = createIpcServer(makeServerOpts());
    expect(server).toBeDefined();
  });

  test("askStream emits streamToken notifications via agentInvoke", async () => {
    const handler: AgentInvokeHandler = async (ctx) => {
      ctx.sendChunk("hello ");
      ctx.sendChunk("world");
      return { reply: "hello world" };
    };

    createIpcServer(makeServerOpts({ agentInvoke: handler }));

    const received: string[] = [];
    await handler({
      clientId: "test",
      input: "say hello",
      stream: true,
      sendChunk: (t) => received.push(t),
    });
    expect(received).toEqual(["hello ", "world"]);
  });
});
