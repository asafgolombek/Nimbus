import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveRuntimeById } from "../../../src/exec/exec-runtimes.ts";
import { extensionProcessEnv } from "../../../src/extensions/spawn-env.ts";
import { policyFromManifest } from "../../../src/platform/sandbox/sandbox-policy.ts";
import { createSandboxRunner } from "../../../src/platform/sandbox/sandbox-runner.ts";
import { buildGeneratedManifest } from "../../../src/toolgen/toolgen-stub.ts";

/**
 * The load-bearing test of the whole runtime-tool-generation feature: proof that a raw `fetch()`
 * inside a GENERATED tool's confined process genuinely fails to reach the network, on every
 * platform Nimbus ships on. Every other safeguard in the feature — the host allow-list, credential
 * binding, the egress ledger — assumes the generated body has no route out except the gateway
 * broker. If a raw `fetch()` worked, all of that would be theater.
 *
 * Guard shape (Windows helper path override, set before any `createSandboxRunner()` call) is
 * copied deliberately from `exec-sandbox.test.ts` / `sandbox-wrapper-spawn.test.ts`: under `bun
 * test`, `process.execPath` resolves to the installed `~/.bun/bin/bun.exe`, not this repo's
 * `src-native` build output, and the runner captures the probe result at construction.
 */

const WIN_HELPER =
  process.env["NIMBUS_SANDBOX_HELPER_PATH"] ??
  resolve(import.meta.dir, "../../../src-native/sandbox-helper-win32/nimbus-sandbox-helper.exe");
if (process.platform === "win32" && process.env["NIMBUS_SANDBOX_HELPER_PATH"] === undefined) {
  process.env["NIMBUS_SANDBOX_HELPER_PATH"] = WIN_HELPER;
}

let server: ReturnType<typeof Bun.serve>;
let hits = 0;
let url = "";
// A fresh, empty temp dir — NEVER the repo root. Granting a huge existing tree (this repo's
// checkout, with node_modules and its symlinks/reparse points) as the sandboxed cwd was measured
// to make the Windows AppContainer ACL grant hang indefinitely; an isolated empty dir grants and
// spawns in well under a second. Also keeps the sandboxed child's writable surface to a directory
// nothing else in the repo depends on.
const workDir = mkdtempSync(join(tmpdir(), "nimbus-toolgen-network-denied-"));

beforeAll(() => {
  hits = 0;
  server = Bun.serve({
    port: 0,
    fetch: () => {
      hits += 1;
      return new Response("hit");
    },
  });
  url = `http://127.0.0.1:${server.port}/`;
});

afterAll(() => {
  server.stop(true);
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup; a leftover empty temp dir is harmless */
  }
});

/**
 * `STARTED` is a POSITIVE EXECUTION MARKER, printed before the fetch is even attempted.
 *
 * Without it, a child that dies for ANY reason before reaching the network — including a denied
 * read on its own interpreter (Windows AppContainer, no read grant: exit 68, no stdout at all) —
 * satisfies "exit != 0 and the server saw no hits" identically to a child that started fine and had
 * its fetch blocked at the OS. Those two outcomes must never be conflated: only the second one
 * proves the sandbox's network denial did the work.
 */
const SCRIPT = (target: string) =>
  `console.log("STARTED"); try { const r = await fetch(${JSON.stringify(target)}); console.log("REACHED:" + r.status); process.exit(0); } catch { process.exit(9); }`;

describe("a generated tool's raw fetch() is blocked on this platform", () => {
  // POSITIVE CONTROL FIRST. Without it, "zero hits" / "no REACHED" passes for any reason at all —
  // including the server never having started, or this platform's `fetch` being broken.
  test("control: the SAME request succeeds UNCONFINED", async () => {
    const proc = Bun.spawn([process.execPath, "-e", SCRIPT(url)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(out).toContain("STARTED");
    expect(exitCode).toBe(0);
    expect(out).toContain("REACHED:200");
    expect(hits).toBe(1);
  }, 30_000);

  test("confined with an empty network set, the request never arrives", async () => {
    const before = hits;
    const runner = await createSandboxRunner();

    // The manifest MUST carry the interpreter's own required read paths, exactly as
    // `exec-gate.ts` does. `buildGeneratedManifest("tg_probe")` with no `runtimeReadPaths` grants
    // `permissions.filesystem.read = []`, and under the Windows AppContainer the confined child
    // then cannot read its own interpreter and dies at exit 68 before executing a single line —
    // which would satisfy every assertion below for the wrong reason (see the SCRIPT/STARTED
    // comment above).
    const runtime = resolveRuntimeById("bun");
    const manifest = buildGeneratedManifest("tg_probe", {
      runtimeReadPaths: runtime.requiredReadPaths(),
    });
    const policy = policyFromManifest(manifest);

    // Do not skip on a `canConfine` failure: a skipped test here proves nothing about whether the
    // sandbox actually confines. Fail loudly with the exact reason instead.
    expect(runner.canConfine(policy)).toBeNull();

    const child = runner.spawn(process.execPath, ["-e", SCRIPT(url)], {
      policy,
      env: extensionProcessEnv({}),
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    try {
      child.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
      });
      child.stderr?.on("data", (c: Buffer) => {
        err += c.toString();
      });

      const code = await new Promise<number>((res) => {
        child.on("error", () => res(-1));
        child.on("close", (c) => res(c ?? -1));
      });

      // All THREE conditions, not two. `STARTED` proves the child really ran; the absence of
      // `REACHED:` proves the fetch never got a response; the unchanged hit count proves the
      // request never arrived at the server. Any two of these can be satisfied by a process that
      // never launched — only all three together distinguish "the sandbox blocked the network"
      // from "the process never started".
      expect(out).toContain("STARTED");
      expect(out).not.toContain("REACHED:");
      expect(code).not.toBe(0);
      expect(hits).toBe(before);
    } finally {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
    // `err` is intentionally unused beyond being captured — kept only so a genuine sandbox
    // failure surfaces its stderr in a debugger, not asserted on: the confinement mechanism
    // differs per platform (bwrap message vs. AppContainer ACL denial vs. SBPL denial) and this
    // test must stay platform-agnostic.
    void err;
  }, 30_000);
});
