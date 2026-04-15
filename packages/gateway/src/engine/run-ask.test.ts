import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { LocalIndex } from "../index/local-index.ts";
import type { ConsentCoordinator } from "../ipc/consent.ts";
import type { PlatformPaths } from "../platform/paths.ts";
import { runAsk } from "./run-ask.ts";
import type { ConnectorDispatcher } from "./types.ts";

const stubPaths: PlatformPaths = {
  configDir: "/tmp/nimbus-test-cfg",
  dataDir: "/tmp/nimbus-test-data",
  logDir: "/tmp/nimbus-test-logs",
  socketPath: "/tmp/nimbus-test.sock",
  extensionsDir: "/tmp/nimbus-test-ext",
  tempDir: "/tmp/nimbus-test-tmp",
};

const stubConsent: ConsentCoordinator = {
  async requestConsent(): Promise<boolean> {
    return false;
  },
  rejectAllPending(): void {},
  pendingCount(): number {
    return 0;
  },
};

const stubDispatcher: ConnectorDispatcher = {
  async dispatch(): Promise<unknown> {
    return null;
  },
};

describe("runAsk", () => {
  test("returns onboarding guidance when index has zero items (no LLM path)", async () => {
    const db = new Database(":memory:");
    LocalIndex.ensureSchema(db);
    const localIndex = new LocalIndex(db);
    const out = await runAsk({
      input: "What did I work on yesterday?",
      stream: false,
      clientId: "test-client",
      paths: stubPaths,
      consentCoordinator: stubConsent,
      localIndex,
      dispatcher: stubDispatcher,
      sendChunk: () => {},
    });
    expect(out.reply).toContain("No data indexed yet");
    expect(out.reply).toContain("nimbus connector auth");
    localIndex.close();
  });
});
