import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeArgs = { method: string; params: unknown };

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: InvokeArgs) => Promise<unknown>>(),
  listenMock:
    vi.fn<(event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { __resetIpcClientForTests, createIpcClient } from "../../src/ipc/client";

const FORBIDDEN_KEYS = [
  "passphrase",
  "recoverySeed",
  "mnemonic",
  "privateKey",
  "encryptedVaultManifest",
] as const;

beforeEach(() => {
  __resetIpcClientForTests();
  invokeMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("parseError — credential redaction", () => {
  for (const key of FORBIDDEN_KEYS) {
    it(`redacts '${key}=<value>' in raw error strings`, async () => {
      invokeMock.mockRejectedValueOnce(`boom with ${key}=super-secret-value-12345 in body`);
      let thrown: Error | null = null;
      try {
        await createIpcClient().call("profile.list", {});
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.message).not.toContain("super-secret-value-12345");
      expect(thrown?.message).toContain("[REDACTED]");
    });

    it(`redacts '"${key}":"..."' in JSON-RPC error payloads`, async () => {
      const leaking = JSON.stringify({
        code: -32010,
        message: `error containing ${key}: sekret-phrase`,
        data: { [key]: "sekret-phrase" },
      });
      invokeMock.mockRejectedValueOnce(leaking);
      let thrown: Error | null = null;
      try {
        await createIpcClient().call("data.import", {});
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown?.message).not.toContain("sekret-phrase");
    });
  }
});
