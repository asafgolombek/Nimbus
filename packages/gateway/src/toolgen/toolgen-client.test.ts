import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { THIS_BINARY_COVERAGE } from "../egress/egress-coverage.ts";
import { CURRENT_SCHEMA_VERSION } from "../index/local-index.ts";
import { runIndexedSchemaMigrations } from "../index/migrations/runner.ts";
import { ToolgenBroker } from "./toolgen-broker.ts";
import { buildToolSpawnSpec, type ToolChildIo, wireToolProtocol } from "./toolgen-client.ts";
import { emitToolScript } from "./toolgen-stub.ts";
import type { ToolgenEnvelope } from "./toolgen-types.ts";

const envelope: ToolgenEnvelope = {
  sessionId: "s1",
  scriptPath: "/opt/nimbus/toolgen/tg_a/index.ts",
  approvedAt: 1,
  artifact: {
    toolId: "tg_a",
    toolName: "t",
    description: "d",
    body: "b",
    approvedHosts: [],
    credentialHosts: [],
    manifest: {
      id: "toolgen.tg_a",
      version: "0.0.0",
      permissions: { network: [], filesystem: { read: ["/opt/nimbus/toolgen/tg_a"], write: [] } },
      updateChannel: "stable",
    },
  },
};

describe("buildToolSpawnSpec", () => {
  const spec = buildToolSpawnSpec(envelope, "/opt/nimbus/toolgen/tg_a");

  test("the script is IMPORTED via -e, never named as the entry point", () => {
    // `bun run <file>` fails under the Windows AppContainer with CouldntReadCurrentDirectory
    // (measured; see exec/exec-runtimes.ts). import() of a granted file works.
    expect(spec.args.join(" ")).toContain("-e");
    expect(spec.args.join(" ")).toContain("import(");
    expect(spec.args).not.toContain("run");
  });

  test("the command line stays far below the Windows 32767 limit regardless of body size", () => {
    expect([spec.command, ...spec.args].join(" ").length).toBeLessThan(4096);
  });

  test("the spawn goes through wrapServerSpec, so the sandbox policy env is set", () => {
    expect(spec.env["NIMBUS_SANDBOX_POLICY_JSON"]).toBeDefined();
    expect(JSON.parse(spec.env["NIMBUS_SANDBOX_POLICY_JSON"] ?? "{}")).toMatchObject({
      permissions: { network: [] },
    });
  });

  test("the file:// URL is built correctly on THIS platform, backslashes included on Windows", () => {
    // `pathToFileURL` (not manual string surgery) is what makes this correct on Windows: a
    // `C:\...` path needs its separators normalised AND its reserved characters percent-encoded
    // before it is a valid URL, and hand-rolling that is exactly the kind of thing that looks
    // right on POSIX and silently breaks on the other platform.
    const href = pathToFileURL(envelope.scriptPath).href;
    expect(spec.args.join(" ")).toContain(JSON.stringify(href));
  });
});

describe("coverage", () => {
  test("the tool class is per-call now that a generated tool can make a request", () => {
    expect(THIS_BINARY_COVERAGE.tool).toBe("per-call");
  });
});

/** A broker that must never actually be called in a test whose script body makes no fetch. */
function unreachableBroker(): ToolgenBroker {
  const db = new Database(":memory:");
  runIndexedSchemaMigrations(db, CURRENT_SCHEMA_VERSION);
  return new ToolgenBroker({
    db,
    now: () => 1,
    maxRequestsPerTool: 0,
    requestTimeoutMs: 1_000,
    resolveHost: async () => {
      throw new Error("unreachableBroker: resolveHost must not be called by this test");
    },
    readCredential: async () => null,
    approvedHostsFor: () => [],
    doFetch: async () => {
      throw new Error("unreachableBroker: doFetch must not be called by this test");
    },
  });
}

/**
 * Adapts a `Bun.spawn` child to the `ToolChildIo` shape `wireToolProtocol` drives, so this test
 * exercises the REAL client protocol logic (`wireToolProtocol`) end to end, over a real process,
 * without going through `SandboxRunner`.
 */
type RoundTripChild = ReturnType<typeof Bun.spawn<"pipe", "pipe", "inherit">>;

function ioFromBunChild(child: RoundTripChild): ToolChildIo {
  let onData: ((chunk: Uint8Array) => void) | undefined;
  const pump = (async (): Promise<void> => {
    const reader = child.stdout.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onData?.(value);
    }
  })();
  // Never allowed to crash the test on its own — a read error surfaces through waitExit/describe/
  // call timing out instead, which is the failure mode worth seeing.
  pump.catch(() => {});

  return {
    writeLine: (line) => {
      child.stdin.write(`${line}\n`);
      child.stdin.flush();
    },
    onStdoutData: (cb) => {
      onData = cb;
    },
    kill: () => {
      child.kill();
    },
    waitExit: async () => {
      await child.exited;
    },
  };
}

describe("runtime round trip", () => {
  // An earlier review noted the emitted protocol's newline framing (emitToolScript writes a "\n"
  // terminator, wireToolProtocol's reader splits on one) was proven only by inspection — if the two
  // ever disagreed, the protocol would deadlock at runtime with no unit test noticing. This test
  // closes that gap by spawning a REAL generated script and driving a REAL describe/call round trip
  // through the production client code (`wireToolProtocol`).
  //
  // The child is spawned directly with `Bun.spawn` rather than through the full `SandboxRunner` —
  // driving real OS-level sandbox confinement (bwrap / sandbox-exec / AppContainer, chosen per
  // platform) from a unit test is impractical, and it is not this test's job: Task 18 covers
  // confinement. `ioFromBunChild` above adapts the Bun subprocess to the same `ToolChildIo` shape
  // `spawnGeneratedTool` builds from a `SandboxRunner`-spawned `ChildProcess`, so the protocol code
  // under test (`wireToolProtocol`) is the exact code the sandboxed path also runs — only how the
  // child got spawned differs.
  test("a real spawned child answers a real describe and a real call over the wire protocol", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nimbus-toolgen-roundtrip-"));
    try {
      const scriptPath = join(dir, "index.ts");
      writeFileSync(
        scriptPath,
        emitToolScript({
          toolId: "rt1",
          toolName: "Round Trip Tool",
          description: "adds two numbers",
          body: "return { ok: true, sum: (args.a ?? 0) + (args.b ?? 0) };",
        }),
      );

      const href = pathToFileURL(scriptPath).href;
      const child = Bun.spawn<"pipe", "pipe", "inherit">({
        cmd: [process.execPath, "-e", `await import(${JSON.stringify(href)});`],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });

      const handle = wireToolProtocol(
        ioFromBunChild(child),
        { ...envelope, scriptPath },
        unreachableBroker(),
      );
      try {
        const described = await handle.describe();
        expect(described).toEqual({ name: "Round Trip Tool", description: "adds two numbers" });

        const called = await handle.call({ a: 2, b: 3 });
        expect(called).toEqual({ ok: true, sum: 5 });
      } finally {
        // Belt and suspenders: handle.close() already kills+waits, but a failing assertion above
        // must not leave a child running either.
        await handle.close();
        child.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
