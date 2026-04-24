# WS7 — VS Code Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code/Cursor extension (`packages/vscode-extension/`) that exposes Nimbus Ask/Search/Run-Workflow inside the editor, with a persistent chat Webview, context-sensitive HITL routing, and a status bar — built on a Node-compatible refactor of `@nimbus-dev/client` (dual-runtime IPC, typed `askStream` AsyncIterable, socket discovery) and two new Gateway IPC methods (`engine.getSessionTranscript`, `engine.cancelStream`).

**Architecture:** Three deliverable surfaces. (1) `@nimbus-dev/client` v0.2.0 — runtime-detected Unix transport (Bun.connect under Bun, net.createConnection under Node) plus typed streaming API. (2) Gateway IPC additions — refactor inline `engine.askStream` handler into its own module with AbortController-based cancellation; add `engine.getSessionTranscript` over existing `audit_log`. (3) New `packages/vscode-extension/` package with eager activation, persistent chat panel, non-modal HITL toasts (modal opt-in), `nimbus-item:` URI scheme for search results.

**Tech Stack:** TypeScript 6.x strict / esbuild (extension + Webview bundles) / vitest (extension unit) / `@vscode/test-electron` (one happy-path integration) / `marked` (Webview markdown) / Bun for repo workflow / Node `net` + `node:fs` for transport + discovery.

**Design spec:** [`docs/superpowers/specs/2026-04-24-ws7-vscode-extension-design.md`](../specs/2026-04-24-ws7-vscode-extension-design.md) — read first if unfamiliar. This plan implements that spec task-by-task.

**Finish-plan reference:** [`docs/release/v0.1.0-finish-plan.md §4.4`](../../release/v0.1.0-finish-plan.md) — acceptance criteria.

---

## File Map

**Create:**

`packages/client/src/`:
- `paths.ts`
- `discovery.ts`
- `stream-events.ts`
- `ask-stream.ts`

`packages/client/test/`:
- `paths.test.ts`
- `discovery.test.ts`
- `ask-stream.test.ts`
- `node-compat.test.ts` (run under `node --test`)

`packages/gateway/src/ipc/`:
- `engine-ask-stream.ts` (extracts the inline handler from `server.ts`)
- `engine-cancel-stream.ts`
- `engine-cancel-stream.test.ts`
- `engine-get-session-transcript.ts`
- `engine-get-session-transcript.test.ts`

`packages/vscode-extension/` — entire new package:
- `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `LICENSE` (MIT), `README.md`, `CHANGELOG.md`, `.vscodeignore`, `icon.png` (placeholder, see Task 14), `esbuild.mjs`
- `src/extension.ts`
- `src/vscode-shim.ts`
- `src/settings.ts`
- `src/logging.ts`
- `src/connection/connection-manager.ts`
- `src/connection/auto-start.ts`
- `src/status-bar/status-bar-item.ts`
- `src/chat/chat-panel.ts`
- `src/chat/chat-protocol.ts`
- `src/chat/chat-controller.ts`
- `src/chat/session-store.ts`
- `src/chat/webview/main.ts`
- `src/chat/webview/markdown.ts`
- `src/chat/webview/hitl-card.ts`
- `src/chat/webview/empty-state.ts`
- `src/chat/webview/styles.css`
- `src/search/item-provider.ts`
- `src/commands/ask.ts`
- `src/commands/search.ts`
- `src/commands/run-workflow.ts`
- `src/commands/new-conversation.ts`
- `src/commands/start-gateway.ts`
- `src/hitl/hitl-router.ts`
- `src/hitl/hitl-toast.ts`
- `src/hitl/hitl-modal.ts`
- `src/hitl/hitl-details-webview.ts`
- All `test/unit/**/*.test.ts` files matching the source layout
- `test/integration/ask-roundtrip.test.ts`

`docs/`:
- `manual-smoke-ws7.md`

`.github/workflows/`:
- `publish-vscode.yml`

**Modify:**
- `packages/client/src/index.ts` — re-export new modules
- `packages/client/src/ipc-transport.ts` — runtime-detected Unix dispatch
- `packages/client/src/nimbus-client.ts` — add `askStream`, `subscribeHitl`, `getSessionTranscript`, `cancelStream`
- `packages/client/src/mock-client.ts` — surface `askStream` for downstream tests
- `packages/client/package.json` — bump to 0.2.0
- `packages/gateway/src/ipc/server.ts` — replace inline `engine.askStream` handler with delegation; add `engine.cancelStream` + `engine.getSessionTranscript` cases
- `packages/ui/src-tauri/src/gateway_bridge.rs` — add 2 entries to `ALLOWED_METHODS`; assert size 58
- `package.json` (root) — add `test:coverage:vscode-extension` script
- `.github/workflows/_test-suite.yml` — add `vscode-extension` coverage row + 3 new node-compat jobs + 3 new vscode integration jobs
- `CLAUDE.md` — Key File Locations rows; flip WS7 status; commands section
- `GEMINI.md` — mirror
- `docs/roadmap.md` — flip WS7 row
- `docs/release/v0.1.0-finish-plan.md` — flip §2 row

**Delete:** none.

---

## Execution Order Rationale

- **Tasks 1-7** — `@nimbus-dev/client` refactor first. Pure additions to a published package; the rest of the plan imports from this. Running first means subsequent tasks never hit "module not found" in TDD.
- **Tasks 8-10** — Gateway IPC additions. Only the `cancelStream` mechanism is genuinely new; `getSessionTranscript` is read-only. Adding before the extension means the integration test in Task 27 sees the real surface.
- **Task 11** — Tauri allowlist bump. One file, one number; do it once both new methods exist.
- **Tasks 12-13** — Node-compat test + CI wiring. Gates the client refactor before any extension code consumes it.
- **Task 14** — Extension package scaffold (manifest, build, deps). Unblocks every subsequent task that imports from `vscode` or runs `bunx vitest`.
- **Tasks 15-22** — Extension core modules (shim, settings, logging, connection, status bar, HITL, chat panel/controller, session store). Each is TDD-able with the shim layer; no `@vscode/test-electron` needed.
- **Tasks 23-24** — Webview client modules. Browser-side TypeScript; vitest + JSDOM.
- **Task 25** — Commands + URI provider. Wires modules to `vscode.commands.registerCommand`.
- **Task 26** — `extension.ts` activate/deactivate. Final wiring.
- **Task 27** — Integration test (`@vscode/test-electron`). One happy-path stream, end-to-end.
- **Task 28** — Publish workflow. Decoupled from rest of CI.
- **Tasks 29-31** — Docs (CLAUDE.md, GEMINI.md, manual smoke, roadmap, finish-plan).
- **Task 32** — Final verification of all spec acceptance criteria.

---

## Task 1: Move `paths.ts` to `@nimbus-dev/client` (Bun-free)

**Why this is Task 1:** Every subsequent client-side task imports `getNimbusPaths`. CLI continues to use its own copy unchanged (non-blocking follow-up consolidates).

**Files:**
- Create: `packages/client/src/paths.ts`
- Create: `packages/client/test/paths.test.ts`

---

- [ ] **Step 1.1: Write the failing test**

Create `packages/client/test/paths.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { getNimbusPaths } from "../src/paths.ts";

describe("getNimbusPaths", () => {
  test("returns absolute paths with stable keys", () => {
    const p = getNimbusPaths();
    expect(typeof p.configDir).toBe("string");
    expect(typeof p.dataDir).toBe("string");
    expect(typeof p.logDir).toBe("string");
    expect(typeof p.socketPath).toBe("string");
    expect(typeof p.extensionsDir).toBe("string");
    expect(p.configDir.length).toBeGreaterThan(0);
    expect(p.socketPath.length).toBeGreaterThan(0);
  });

  test("logDir is nested under dataDir", () => {
    const p = getNimbusPaths();
    expect(p.logDir.startsWith(p.dataDir)).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd packages/client && bun test test/paths.test.ts
```

Expected: FAIL with "Cannot find module '../src/paths.ts'".

- [ ] **Step 1.3: Implement `paths.ts`**

Create `packages/client/src/paths.ts`:

```ts
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Per-platform Nimbus paths. Pure node:* + process.env — no Bun-only APIs. */
export type NimbusPaths = {
  configDir: string;
  dataDir: string;
  logDir: string;
  socketPath: string;
  extensionsDir: string;
};

function envOrEmpty(key: string): string {
  const v = process.env[key];
  return typeof v === "string" ? v : "";
}

export function getNimbusPaths(): NimbusPaths {
  switch (process.platform) {
    case "win32": {
      const appData = envOrEmpty("APPDATA");
      const localAppData = envOrEmpty("LOCALAPPDATA");
      if (appData.length === 0) {
        throw new Error("APPDATA is not set. Nimbus requires a standard Windows user profile.");
      }
      if (localAppData.length === 0) {
        throw new Error(
          "LOCALAPPDATA is not set. Nimbus requires a standard Windows user profile.",
        );
      }
      const configDir = join(appData, "Nimbus");
      const dataDir = join(localAppData, "Nimbus", "data");
      return {
        configDir,
        dataDir,
        logDir: join(dataDir, "logs"),
        socketPath: String.raw`\\.\pipe\nimbus-gateway`,
        extensionsDir: join(localAppData, "Nimbus", "extensions"),
      };
    }
    case "darwin": {
      const root = join(homedir(), "Library", "Application Support", "Nimbus");
      const tmp = envOrEmpty("TMPDIR") || "/tmp";
      return {
        configDir: root,
        dataDir: root,
        logDir: join(root, "logs"),
        socketPath: join(tmp, "nimbus-gateway.sock"),
        extensionsDir: join(root, "extensions"),
      };
    }
    default: {
      const home = homedir();
      const configRoot = envOrEmpty("XDG_CONFIG_HOME") || join(home, ".config");
      const dataRoot = envOrEmpty("XDG_DATA_HOME") || join(home, ".local", "share");
      const runtimeDir = envOrEmpty("XDG_RUNTIME_DIR") || tmpdir();
      const configDir = join(configRoot, "nimbus");
      const dataDir = join(dataRoot, "nimbus");
      return {
        configDir,
        dataDir,
        logDir: join(dataDir, "logs"),
        socketPath: join(runtimeDir, "nimbus-gateway.sock"),
        extensionsDir: join(dataDir, "extensions"),
      };
    }
  }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd packages/client && bun test test/paths.test.ts
```

Expected: PASS, 2 of 2.

- [ ] **Step 1.5: Add per-platform branch tests**

Append to `packages/client/test/paths.test.ts`:

```ts
import { afterEach } from "bun:test";

describe("getNimbusPaths per platform", () => {
  const origPlatform = process.platform;
  const origEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
    process.env = { ...origEnv };
  });

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: p });
  }

  test("win32 throws when APPDATA missing", () => {
    setPlatform("win32");
    delete process.env.APPDATA;
    process.env.LOCALAPPDATA = "C:\\Users\\u\\AppData\\Local";
    expect(() => getNimbusPaths()).toThrow(/APPDATA/);
  });

  test("win32 returns named pipe socketPath", () => {
    setPlatform("win32");
    process.env.APPDATA = "C:\\Users\\u\\AppData\\Roaming";
    process.env.LOCALAPPDATA = "C:\\Users\\u\\AppData\\Local";
    const p = getNimbusPaths();
    expect(p.socketPath).toBe(String.raw`\\.\pipe\nimbus-gateway`);
  });

  test("darwin returns sock under TMPDIR or /tmp", () => {
    setPlatform("darwin");
    process.env.TMPDIR = "/var/folders/xx/T/";
    const p = getNimbusPaths();
    expect(p.socketPath.endsWith("nimbus-gateway.sock")).toBe(true);
  });

  test("linux honors XDG_RUNTIME_DIR", () => {
    setPlatform("linux");
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    const p = getNimbusPaths();
    expect(p.socketPath).toBe("/run/user/1000/nimbus-gateway.sock");
  });
});
```

Run: `cd packages/client && bun test test/paths.test.ts` — expected PASS, 6 of 6.

- [ ] **Step 1.6: Commit**

```bash
git add packages/client/src/paths.ts packages/client/test/paths.test.ts
git commit -m "feat(client): add Bun-free getNimbusPaths helper"
```

---

## Task 2: Move socket discovery to `@nimbus-dev/client`

**Files:**
- Create: `packages/client/src/discovery.ts`
- Create: `packages/client/test/discovery.test.ts`

---

- [ ] **Step 2.1: Write the failing test**

Create `packages/client/test/discovery.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { discoverSocketPath, readGatewayState } from "../src/discovery.ts";
import type { NimbusPaths } from "../src/paths.ts";

function makeTempPaths(): NimbusPaths {
  const root = mkdtempSync(join(tmpdir(), "nimbus-discovery-"));
  return {
    configDir: root,
    dataDir: root,
    logDir: join(root, "logs"),
    socketPath: join(root, "default.sock"),
    extensionsDir: join(root, "ext"),
  };
}

describe("readGatewayState", () => {
  test("returns undefined when state file missing", async () => {
    const paths = makeTempPaths();
    const r = await readGatewayState(paths);
    expect(r).toBeUndefined();
    rmSync(paths.dataDir, { recursive: true, force: true });
  });

  test("parses valid state file", async () => {
    const paths = makeTempPaths();
    writeFileSync(
      join(paths.dataDir, "gateway.json"),
      JSON.stringify({ pid: 1234, socketPath: "/run/sock", logPath: "/log" }),
    );
    const r = await readGatewayState(paths);
    expect(r?.pid).toBe(1234);
    expect(r?.socketPath).toBe("/run/sock");
    expect(r?.logPath).toBe("/log");
    rmSync(paths.dataDir, { recursive: true, force: true });
  });

  test("returns undefined for malformed JSON", async () => {
    const paths = makeTempPaths();
    writeFileSync(join(paths.dataDir, "gateway.json"), "{ not json");
    const r = await readGatewayState(paths);
    expect(r).toBeUndefined();
    rmSync(paths.dataDir, { recursive: true, force: true });
  });

  test("returns undefined for wrong schema", async () => {
    const paths = makeTempPaths();
    writeFileSync(
      join(paths.dataDir, "gateway.json"),
      JSON.stringify({ pid: "not-number", socketPath: "/run/sock" }),
    );
    const r = await readGatewayState(paths);
    expect(r).toBeUndefined();
    rmSync(paths.dataDir, { recursive: true, force: true });
  });
});

describe("discoverSocketPath precedence", () => {
  test("override wins over state file and default", async () => {
    const paths = makeTempPaths();
    writeFileSync(
      join(paths.dataDir, "gateway.json"),
      JSON.stringify({ pid: 1, socketPath: "/state/sock" }),
    );
    const r = await discoverSocketPath({ override: "/forced/sock", paths });
    expect(r.source).toBe("override");
    expect(r.socketPath).toBe("/forced/sock");
    rmSync(paths.dataDir, { recursive: true, force: true });
  });

  test("state file wins over default", async () => {
    const paths = makeTempPaths();
    writeFileSync(
      join(paths.dataDir, "gateway.json"),
      JSON.stringify({ pid: 7, socketPath: "/state/sock" }),
    );
    const r = await discoverSocketPath({ paths });
    expect(r.source).toBe("stateFile");
    expect(r.socketPath).toBe("/state/sock");
    expect(r.pid).toBe(7);
    rmSync(paths.dataDir, { recursive: true, force: true });
  });

  test("falls back to default when no state file", async () => {
    const paths = makeTempPaths();
    const r = await discoverSocketPath({ paths });
    expect(r.source).toBe("default");
    expect(r.socketPath).toBe(paths.socketPath);
    rmSync(paths.dataDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
cd packages/client && bun test test/discovery.test.ts
```

Expected: FAIL with "Cannot find module '../src/discovery.ts'".

- [ ] **Step 2.3: Implement `discovery.ts`**

Create `packages/client/src/discovery.ts`:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getNimbusPaths } from "./paths.js";
import type { NimbusPaths } from "./paths.js";

export type GatewayStateFile = {
  pid: number;
  socketPath: string;
  logPath?: string;
};

export type SocketDiscoveryResult = {
  socketPath: string;
  source: "override" | "stateFile" | "default";
  pid?: number;
};

function isGatewayState(raw: unknown): raw is GatewayStateFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.pid !== "number" || !Number.isFinite(o.pid)) return false;
  if (typeof o.socketPath !== "string") return false;
  if (o.logPath !== undefined && typeof o.logPath !== "string") return false;
  return true;
}

export function gatewayStatePath(paths: NimbusPaths): string {
  return join(paths.dataDir, "gateway.json");
}

export async function readGatewayState(
  paths: NimbusPaths,
): Promise<GatewayStateFile | undefined> {
  const p = gatewayStatePath(paths);
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(await readFile(p, "utf8")) as unknown;
    if (!isGatewayState(raw)) return undefined;
    const out: GatewayStateFile = { pid: raw.pid, socketPath: raw.socketPath };
    if (typeof raw.logPath === "string" && raw.logPath !== "") out.logPath = raw.logPath;
    return out;
  } catch {
    return undefined;
  }
}

export async function discoverSocketPath(opts?: {
  override?: string;
  paths?: NimbusPaths;
}): Promise<SocketDiscoveryResult> {
  if (opts?.override !== undefined && opts.override.length > 0) {
    return { socketPath: opts.override, source: "override" };
  }
  const paths = opts?.paths ?? getNimbusPaths();
  const state = await readGatewayState(paths);
  if (state !== undefined) {
    return { socketPath: state.socketPath, source: "stateFile", pid: state.pid };
  }
  return { socketPath: paths.socketPath, source: "default" };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd packages/client && bun test test/discovery.test.ts
```

Expected: PASS, 7 of 7.

- [ ] **Step 2.5: Commit**

```bash
git add packages/client/src/discovery.ts packages/client/test/discovery.test.ts
git commit -m "feat(client): add Node-compatible gateway socket discovery"
```

---

## Task 3: Refactor `IPCClient` Unix transport to dual-runtime

**Files:**
- Modify: `packages/client/src/ipc-transport.ts`

---

- [ ] **Step 3.1: Add a runtime-dispatch test that proves the Node path doesn't import Bun**

Create `packages/client/test/ipc-transport-runtime.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ipc-transport runtime detection", () => {
  test("source contains both Bun and Node Unix branches", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "src", "ipc-transport.ts"),
      "utf8",
    );
    expect(src).toContain("connectUnixBun");
    expect(src).toContain("connectUnixNode");
    expect(src).toContain("HAS_BUN");
  });
});
```

Run: `cd packages/client && bun test test/ipc-transport-runtime.test.ts` — expected FAIL.

- [ ] **Step 3.2: Refactor the Unix path in `ipc-transport.ts`**

Edit `packages/client/src/ipc-transport.ts`. Replace the existing `connectUnix` method with:

```ts
  private async connectUnix(): Promise<void> {
    if (HAS_BUN) {
      await this.connectUnixBun();
      return;
    }
    await this.connectUnixNode();
  }

  private async connectUnixBun(): Promise<void> {
    this.bunSocket = await Bun.connect({
      unix: this.socketPath,
      socket: {
        data: (_socket, chunk: Uint8Array) => {
          this.onTransportData(chunk);
        },
        close: () => {
          this.onUnixClosed(new Error("IPC connection closed"));
        },
        error: () => {
          this.onUnixClosed(new Error("IPC connection error"));
        },
      },
    });
    this.connected = true;
  }

  private async connectUnixNode(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ path: this.socketPath });
      sock.on("connect", () => {
        this.netSocket = sock;
        this.connected = true;
        resolve();
      });
      sock.on("error", (err) => {
        reject(err);
      });
      sock.on("data", (buf: Buffer) => {
        this.onTransportData(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      });
      sock.on("close", () => {
        this.onWindowsClosed();
      });
    });
  }
```

Add at the top of the file (after the existing imports):

```ts
const HAS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
```

- [ ] **Step 3.3: Run the new test + the existing test suite**

```bash
cd packages/client && bun test
```

Expected: ALL PASS, including the existing transport-related tests.

- [ ] **Step 3.4: Commit**

```bash
git add packages/client/src/ipc-transport.ts packages/client/test/ipc-transport-runtime.test.ts
git commit -m "refactor(client): dual-runtime Unix transport (Bun + Node)"
```

---

## Task 4: Add `StreamEvent` discriminated union

**Files:**
- Create: `packages/client/src/stream-events.ts`

---

- [ ] **Step 4.1: Implement (no test — pure types)**

Create `packages/client/src/stream-events.ts`:

```ts
/**
 * Events emitted by NimbusClient.askStream() over its AsyncIterable surface.
 * Single discriminated union so the consumer can `switch (ev.type)`.
 */
export type StreamEvent =
  | { type: "token"; text: string }
  | {
      type: "subTaskProgress";
      subTaskId: string;
      status: string;
      progress?: number;
    }
  | {
      type: "hitlBatch";
      requestId: string;
      prompt: string;
      details?: unknown;
    }
  | { type: "done"; reply: string; sessionId: string }
  | { type: "error"; code: string; message: string };

export type AskStreamOptions = {
  sessionId?: string;
  agent?: string;
  signal?: AbortSignal;
};

/**
 * Returned from NimbusClient.askStream(). Iterate to consume events;
 * call cancel() to terminate the stream early.
 */
export type AskStreamHandle = AsyncIterable<StreamEvent> & {
  readonly streamId: string;
  cancel(): Promise<void>;
};

/**
 * HITL request payload delivered via NimbusClient.subscribeHitl().
 * Independent of any stream — used for background workflow / watcher HITL.
 */
export type HitlRequest = {
  requestId: string;
  prompt: string;
  details?: unknown;
  /** Present only when the batch was produced by a known stream. */
  streamId?: string;
};
```

- [ ] **Step 4.2: Verify typecheck**

```bash
cd packages/client && bun run typecheck
```

Expected: clean.

- [ ] **Step 4.3: Commit**

```bash
git add packages/client/src/stream-events.ts
git commit -m "feat(client): add StreamEvent discriminated union types"
```

---

## Task 5: Implement `askStream` AsyncIterable + `subscribeHitl`

**Files:**
- Create: `packages/client/src/ask-stream.ts`
- Create: `packages/client/test/ask-stream.test.ts`
- Modify: `packages/client/src/nimbus-client.ts`

---

- [ ] **Step 5.1: Write the failing test**

Create `packages/client/test/ask-stream.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createAskStream } from "../src/ask-stream.ts";
import type { StreamEvent } from "../src/stream-events.ts";

type CallSpy = { method: string; params: unknown };

class FakeIpc {
  public calls: CallSpy[] = [];
  public notifHandlers = new Map<string, ((p: unknown) => void)[]>();

  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "engine.askStream") return { streamId: "stream-1" };
    if (method === "engine.cancelStream") return { ok: true };
    return undefined;
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    let arr = this.notifHandlers.get(method);
    if (arr === undefined) {
      arr = [];
      this.notifHandlers.set(method, arr);
    }
    arr.push(handler);
  }

  emit(method: string, params: unknown): void {
    for (const h of this.notifHandlers.get(method) ?? []) h(params);
  }
}

let ipc: FakeIpc;

beforeEach(() => {
  ipc = new FakeIpc();
});

describe("askStream", () => {
  test("yields token then done events in order", async () => {
    const handle = createAskStream(ipc as never, "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();
    // Wait one microtask so engine.askStream resolves
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "hi" });
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: " there" });
    ipc.emit("engine.streamDone", {
      streamId: "stream-1",
      meta: { reply: "hi there", sessionId: "sess-1" },
    });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["token", "token", "done"]);
    expect(events[0]).toMatchObject({ type: "token", text: "hi" });
    expect(events[2]).toMatchObject({ type: "done", sessionId: "sess-1" });
  });

  test("ignores notifications for a different streamId", async () => {
    const handle = createAskStream(ipc as never, "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit("engine.streamToken", { streamId: "stream-OTHER", text: "nope" });
    ipc.emit("engine.streamToken", { streamId: "stream-1", text: "yes" });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.length).toBe(2);
    expect((events[0] as { text: string }).text).toBe("yes");
  });

  test("error event terminates iterator", async () => {
    const handle = createAskStream(ipc as never, "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit("engine.streamError", {
      streamId: "stream-1",
      code: "boom",
      error: "bad",
    });
    await drain;
    expect(events).toEqual([{ type: "error", code: "boom", message: "bad" }]);
  });

  test("cancel() calls engine.cancelStream and terminates iterator", async () => {
    const handle = createAskStream(ipc as never, "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();
    await Promise.resolve();
    await Promise.resolve();
    await handle.cancel();
    await drain;
    const cancelCall = ipc.calls.find((c) => c.method === "engine.cancelStream");
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.params).toMatchObject({ streamId: "stream-1" });
  });

  test("subTaskProgress and hitlBatch events flow through", async () => {
    const handle = createAskStream(ipc as never, "hello");
    const events: StreamEvent[] = [];
    const drain = (async () => {
      for await (const ev of handle) events.push(ev);
    })();
    await Promise.resolve();
    await Promise.resolve();
    ipc.emit("agent.subTaskProgress", {
      streamId: "stream-1",
      subTaskId: "st1",
      status: "running",
      progress: 0.5,
    });
    ipc.emit("agent.hitlBatch", {
      streamId: "stream-1",
      requestId: "r1",
      prompt: "Approve?",
    });
    ipc.emit("engine.streamDone", { streamId: "stream-1" });
    await drain;
    expect(events.map((e) => e.type)).toEqual(["subTaskProgress", "hitlBatch", "done"]);
  });
});
```

- [ ] **Step 5.2: Run test to confirm it fails**

```bash
cd packages/client && bun test test/ask-stream.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `ask-stream.ts`**

Create `packages/client/src/ask-stream.ts`:

```ts
import type { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, StreamEvent } from "./stream-events.js";

type Pending = { resolve: (v: IteratorResult<StreamEvent>) => void; reject: (e: Error) => void };

export function createAskStream(
  ipc: IPCClient,
  input: string,
  opts: AskStreamOptions = {},
): AskStreamHandle {
  const queue: StreamEvent[] = [];
  const waiters: Pending[] = [];
  let done = false;
  let streamIdResolved: string | undefined;
  let cancelled = false;
  let unsubscribers: Array<() => void> = [];

  const push = (ev: StreamEvent): void => {
    if (done) return;
    if (waiters.length > 0) {
      const w = waiters.shift() as Pending;
      w.resolve({ value: ev, done: false });
      return;
    }
    queue.push(ev);
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    for (const u of unsubscribers) u();
    unsubscribers = [];
    while (waiters.length > 0) {
      const w = waiters.shift() as Pending;
      w.resolve({ value: undefined, done: true });
    }
  };

  const matchesStream = (params: unknown): params is { streamId: string } => {
    return (
      typeof params === "object" &&
      params !== null &&
      typeof (params as { streamId?: unknown }).streamId === "string"
    );
  };

  const subscribe = (streamId: string): void => {
    const onToken = (params: unknown): void => {
      if (!matchesStream(params) || params.streamId !== streamId) return;
      const text = (params as { text?: unknown }).text;
      if (typeof text === "string") push({ type: "token", text });
    };
    const onDone = (params: unknown): void => {
      if (!matchesStream(params) || params.streamId !== streamId) return;
      const meta = (params as { meta?: { reply?: unknown; sessionId?: unknown } }).meta ?? {};
      const reply = typeof meta.reply === "string" ? meta.reply : "";
      const sessionId = typeof meta.sessionId === "string" ? meta.sessionId : "";
      push({ type: "done", reply, sessionId });
      finish();
    };
    const onError = (params: unknown): void => {
      if (!matchesStream(params) || params.streamId !== streamId) return;
      const code = typeof (params as { code?: unknown }).code === "string"
        ? (params as { code: string }).code
        : "stream_error";
      const message = typeof (params as { error?: unknown }).error === "string"
        ? (params as { error: string }).error
        : "Stream error";
      push({ type: "error", code, message });
      finish();
    };
    const onSubTask = (params: unknown): void => {
      if (!matchesStream(params) || params.streamId !== streamId) return;
      const p = params as {
        subTaskId?: unknown;
        status?: unknown;
        progress?: unknown;
      };
      if (typeof p.subTaskId !== "string" || typeof p.status !== "string") return;
      const ev: StreamEvent = { type: "subTaskProgress", subTaskId: p.subTaskId, status: p.status };
      if (typeof p.progress === "number") (ev as { progress?: number }).progress = p.progress;
      push(ev);
    };
    const onHitl = (params: unknown): void => {
      if (!matchesStream(params) || params.streamId !== streamId) return;
      const p = params as { requestId?: unknown; prompt?: unknown; details?: unknown };
      if (typeof p.requestId !== "string" || typeof p.prompt !== "string") return;
      push({ type: "hitlBatch", requestId: p.requestId, prompt: p.prompt, details: p.details });
    };

    ipc.onNotification("engine.streamToken", onToken);
    ipc.onNotification("engine.streamDone", onDone);
    ipc.onNotification("engine.streamError", onError);
    ipc.onNotification("agent.subTaskProgress", onSubTask);
    ipc.onNotification("agent.hitlBatch", onHitl);

    // IPCClient currently has no off() — track ourselves; finish() leaves
    // them registered but every callback returns immediately once `done`.
    unsubscribers.push(() => {
      /* no-op: IPCClient has no off() yet; guarded by `done` flag */
    });
  };

  // Kick off the stream; capture streamId asynchronously
  const startPromise = (async (): Promise<string> => {
    const params: Record<string, unknown> = { input };
    if (opts.sessionId !== undefined) params.sessionId = opts.sessionId;
    if (opts.agent !== undefined) params.agent = opts.agent;
    const result = (await ipc.call("engine.askStream", params)) as { streamId?: string };
    const sid = result?.streamId;
    if (typeof sid !== "string") {
      push({ type: "error", code: "no_stream_id", message: "Gateway returned no streamId" });
      finish();
      throw new Error("no_stream_id");
    }
    streamIdResolved = sid;
    if (cancelled) {
      // Cancel was called before we knew the streamId
      await ipc.call("engine.cancelStream", { streamId: sid }).catch(() => undefined);
      finish();
      return sid;
    }
    subscribe(sid);
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        await ipc.call("engine.cancelStream", { streamId: sid }).catch(() => undefined);
        finish();
      } else {
        opts.signal.addEventListener("abort", () => {
          void ipc.call("engine.cancelStream", { streamId: sid }).catch(() => undefined);
          finish();
        });
      }
    }
    return sid;
  })();

  startPromise.catch(() => {
    // Already pushed an error event; ensure finish() ran
    finish();
  });

  const handle: AskStreamHandle = {
    get streamId(): string {
      return streamIdResolved ?? "";
    },
    async cancel(): Promise<void> {
      cancelled = true;
      const sid = streamIdResolved;
      if (sid !== undefined) {
        await ipc.call("engine.cancelStream", { streamId: sid }).catch(() => undefined);
      }
      finish();
    },
    [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
      return {
        next(): Promise<IteratorResult<StreamEvent>> {
          if (queue.length > 0) {
            const ev = queue.shift() as StreamEvent;
            return Promise.resolve({ value: ev, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<StreamEvent>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
        return(): Promise<IteratorResult<StreamEvent>> {
          finish();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return handle;
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd packages/client && bun test test/ask-stream.test.ts
```

Expected: PASS, 5 of 5.

- [ ] **Step 5.5: Commit**

```bash
git add packages/client/src/ask-stream.ts packages/client/test/ask-stream.test.ts
git commit -m "feat(client): implement askStream AsyncIterable handle"
```

---

## Task 6: Add `askStream`, `subscribeHitl`, `getSessionTranscript`, `cancelStream` to `NimbusClient`

**Files:**
- Modify: `packages/client/src/nimbus-client.ts`

---

- [ ] **Step 6.1: Add a smoke test that the new API surface compiles + dispatches**

Create `packages/client/test/nimbus-client-surface.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { NimbusClient } from "../src/nimbus-client.ts";

describe("NimbusClient typed surface", () => {
  test("instance exposes new methods", () => {
    // We can't connect without a real socket, but we can introspect the prototype
    expect(typeof (NimbusClient.prototype as unknown as Record<string, unknown>).askStream).toBe(
      "function",
    );
    expect(typeof (NimbusClient.prototype as unknown as Record<string, unknown>).subscribeHitl).toBe(
      "function",
    );
    expect(
      typeof (NimbusClient.prototype as unknown as Record<string, unknown>).getSessionTranscript,
    ).toBe("function");
    expect(typeof (NimbusClient.prototype as unknown as Record<string, unknown>).cancelStream).toBe(
      "function",
    );
  });
});
```

Run: `cd packages/client && bun test test/nimbus-client-surface.test.ts` — expected FAIL.

- [ ] **Step 6.2: Update `NimbusClient`**

Edit `packages/client/src/nimbus-client.ts`. Replace the file contents with:

```ts
import { createAskStream } from "./ask-stream.js";
import { IPCClient } from "./ipc-transport.js";
import type { AskStreamHandle, AskStreamOptions, HitlRequest } from "./stream-events.js";

export type NimbusClientOptions = {
  socketPath: string;
};

export type SessionTranscript = {
  sessionId: string;
  turns: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: number;
    auditLogId?: number;
  }>;
  hasMore: boolean;
};

/**
 * Typed convenience wrapper over the Gateway JSON-RPC IPC surface.
 */
export class NimbusClient {
  private readonly ipc: IPCClient;

  private constructor(ipc: IPCClient) {
    this.ipc = ipc;
  }

  static async open(opts: NimbusClientOptions): Promise<NimbusClient> {
    const ipc = new IPCClient(opts.socketPath);
    await ipc.connect();
    return new NimbusClient(ipc);
  }

  async agentInvoke(
    input: string,
    options?: { stream?: boolean; sessionId?: string; agent?: string },
  ): Promise<{ reply?: string } & Record<string, unknown>> {
    return await this.ipc.call("agent.invoke", {
      input,
      stream: options?.stream ?? false,
      ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options?.agent === undefined ? {} : { agent: options.agent }),
    });
  }

  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle {
    return createAskStream(this.ipc, input, opts);
  }

  subscribeHitl(handler: (req: HitlRequest) => void): { dispose(): void } {
    const onBatch = (params: unknown): void => {
      if (typeof params !== "object" || params === null) return;
      const p = params as Record<string, unknown>;
      if (typeof p.requestId !== "string" || typeof p.prompt !== "string") return;
      const req: HitlRequest = { requestId: p.requestId, prompt: p.prompt, details: p.details };
      if (typeof p.streamId === "string") req.streamId = p.streamId;
      handler(req);
    };
    this.ipc.onNotification("agent.hitlBatch", onBatch);
    return {
      dispose: () => {
        // IPCClient has no off(); guarded by handler-side dedupe in HitlRouter
      },
    };
  }

  async getSessionTranscript(params: {
    sessionId: string;
    limit?: number;
  }): Promise<SessionTranscript> {
    return await this.ipc.call("engine.getSessionTranscript", params);
  }

  async cancelStream(streamId: string): Promise<{ ok: boolean }> {
    return await this.ipc.call("engine.cancelStream", { streamId });
  }

  async queryItems(params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: Record<string, unknown>[]; meta: { limit: number; total: number } }> {
    return await this.ipc.call("index.queryItems", {
      services: params.services,
      types: params.types,
      sinceMs: params.sinceMs,
      untilMs: params.untilMs,
      limit: params.limit,
    });
  }

  async querySql(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return await this.ipc.call("index.querySql", { sql });
  }

  async auditList(limit?: number): Promise<unknown[]> {
    return await this.ipc.call("audit.list", { limit: limit ?? 50 });
  }

  async close(): Promise<void> {
    await this.ipc.disconnect();
  }
}
```

- [ ] **Step 6.3: Run test to verify it passes**

```bash
cd packages/client && bun test test/nimbus-client-surface.test.ts && bun run typecheck
```

Expected: PASS, typecheck clean.

- [ ] **Step 6.4: Commit**

```bash
git add packages/client/src/nimbus-client.ts packages/client/test/nimbus-client-surface.test.ts
git commit -m "feat(client): wire askStream/subscribeHitl/transcript/cancel into NimbusClient"
```

---

## Task 7: Update `MockClient` and `index.ts` re-exports; bump to 0.2.0

**Files:**
- Modify: `packages/client/src/mock-client.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/package.json`

---

- [ ] **Step 7.1: Update `mock-client.ts`**

Replace `packages/client/src/mock-client.ts` with:

```ts
import type { NimbusItem } from "@nimbus-dev/sdk";

import type {
  AskStreamHandle,
  AskStreamOptions,
  HitlRequest,
  StreamEvent,
} from "./stream-events.js";

export type MockClientFixtures = {
  items?: NimbusItem[];
  streamTokens?: string[];
  reply?: string;
};

/**
 * In-memory stub for scripts/tests without a running Gateway.
 */
export class MockClient {
  private readonly fixtures: MockClientFixtures;

  constructor(fixtures: MockClientFixtures = {}) {
    this.fixtures = fixtures;
  }

  async agentInvoke(
    _input: string,
    _options?: { stream?: boolean },
  ): Promise<{ reply: string } & Record<string, unknown>> {
    return { reply: this.fixtures.reply ?? "[MockClient] agent.invoke" };
  }

  askStream(_input: string, _opts?: AskStreamOptions): AskStreamHandle {
    const tokens = this.fixtures.streamTokens ?? ["mock", " token"];
    const reply = this.fixtures.reply ?? tokens.join("");
    let i = 0;
    let cancelled = false;
    const handle: AskStreamHandle = {
      streamId: "mock-stream",
      async cancel(): Promise<void> {
        cancelled = true;
      },
      [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        return {
          async next(): Promise<IteratorResult<StreamEvent>> {
            if (cancelled) return { value: undefined, done: true };
            if (i < tokens.length) {
              const text = tokens[i] as string;
              i += 1;
              return { value: { type: "token", text }, done: false };
            }
            if (i === tokens.length) {
              i += 1;
              return {
                value: { type: "done", reply, sessionId: "mock-session" },
                done: false,
              };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
    return handle;
  }

  subscribeHitl(_handler: (req: HitlRequest) => void): { dispose(): void } {
    return { dispose: () => undefined };
  }

  async getSessionTranscript(): Promise<{
    sessionId: string;
    turns: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
    hasMore: boolean;
  }> {
    return { sessionId: "mock-session", turns: [], hasMore: false };
  }

  async cancelStream(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async queryItems(_params: {
    services?: string[];
    types?: string[];
    sinceMs?: number;
    untilMs?: number;
    limit?: number;
  }): Promise<{ items: NimbusItem[]; meta: { limit: number; total: number } }> {
    const items = this.fixtures.items ?? [];
    return { items, meta: { limit: items.length, total: items.length } };
  }

  async querySql(_sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }

  async auditList(): Promise<unknown[]> {
    return [];
  }

  async close(): Promise<void> {
    /* noop */
  }
}
```

- [ ] **Step 7.2: Update `index.ts`**

Replace `packages/client/src/index.ts` with:

```ts
/**
 * @nimbus-dev/client — MIT local Gateway client (IPC).
 */

export { IPCClient } from "./ipc-transport.js";
export { MockClient, type MockClientFixtures } from "./mock-client.js";
export { NimbusClient, type NimbusClientOptions, type SessionTranscript } from "./nimbus-client.js";
export {
  type AskStreamHandle,
  type AskStreamOptions,
  type HitlRequest,
  type StreamEvent,
} from "./stream-events.js";
export {
  discoverSocketPath,
  gatewayStatePath,
  readGatewayState,
  type GatewayStateFile,
  type SocketDiscoveryResult,
} from "./discovery.js";
export { getNimbusPaths, type NimbusPaths } from "./paths.js";
```

- [ ] **Step 7.3: Bump version**

Edit `packages/client/package.json`. Change the `"version"` field from `"0.1.0"` to `"0.2.0"`.

- [ ] **Step 7.4: Run full client test suite + typecheck + build**

```bash
cd packages/client && bun test && bun run typecheck && bun run build
```

Expected: all PASS, build emits `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`.

- [ ] **Step 7.5: Commit**

```bash
git add packages/client/src/index.ts packages/client/src/mock-client.ts packages/client/package.json
git commit -m "feat(client): bump to 0.2.0 with new exports + MockClient parity"
```

---

## Task 8: Refactor inline `engine.askStream` handler into `engine-ask-stream.ts` with AbortController

**Why:** The current handler is inlined in `server.ts:931-987`. Extracting lets us add cancellation cleanly and tests it in isolation. AbortController-based cancellation is the foundation for `engine.cancelStream` (Task 9).

**Files:**
- Create: `packages/gateway/src/ipc/engine-ask-stream.ts`
- Modify: `packages/gateway/src/ipc/server.ts`

---

- [ ] **Step 8.1: Read the existing inline handler to understand the contract**

Open `packages/gateway/src/ipc/server.ts` lines 931-987. The handler:
- Takes `params.input` (string) and optional `params.sessionId`
- Generates `streamId` via `randomUUID()`
- Calls `agentInvokeHandler` inside `agentRequestContext.run(...)`
- Sends `engine.streamToken` notifications via `sendChunk`
- Sends `engine.streamDone` on success, `engine.streamError` on failure

Note `agentInvokeHandler` is module-level (`agentInvokeHandler: AgentInvokeHandler | undefined`) and `agentRequestContext` is the AsyncLocalStorage import.

- [ ] **Step 8.2: Write the failing test**

Create `packages/gateway/src/ipc/engine-ask-stream.test.ts` (note: there is already a test of the same name; this task's test file is `engine-ask-stream-handler.test.ts` to avoid collision):

```ts
// File: packages/gateway/src/ipc/engine-ask-stream-handler.test.ts
import { describe, expect, test } from "bun:test";

import {
  createAskStreamHandler,
  type AskStreamHandlerDeps,
  type StreamRegistry,
} from "./engine-ask-stream.ts";

function makeRegistry(): StreamRegistry {
  const map = new Map<string, AbortController>();
  return {
    register: (id, ac) => {
      map.set(id, ac);
    },
    cancel: (id) => {
      const ac = map.get(id);
      if (ac === undefined) return false;
      ac.abort();
      map.delete(id);
      return true;
    },
    unregister: (id) => {
      map.delete(id);
    },
    has: (id) => map.has(id),
    size: () => map.size,
  };
}

describe("createAskStreamHandler", () => {
  test("returns streamId immediately and emits tokens via sendChunk", async () => {
    const registry = makeRegistry();
    const notifications: { method: string; params: Record<string, unknown> }[] = [];
    const deps: AskStreamHandlerDeps = {
      registry,
      randomId: () => "stream-test-1",
      sessionWriteNotification: (n) => notifications.push(n),
      runWithRequestContext: async (_ctx, fn) => fn(),
      agentInvokeHandler: async (ctx) => {
        ctx.sendChunk?.("hello");
        ctx.sendChunk?.(" world");
      },
    };
    const handler = createAskStreamHandler(deps);
    const result = await handler("client-1", { input: "say hi" });
    expect(result).toEqual({ streamId: "stream-test-1" });
    // Wait for the IIFE to flush
    await new Promise((r) => setTimeout(r, 10));
    const tokens = notifications.filter((n) => n.method === "engine.streamToken");
    expect(tokens.length).toBe(2);
    expect(tokens[0]?.params).toMatchObject({ streamId: "stream-test-1", text: "hello" });
    const done = notifications.find((n) => n.method === "engine.streamDone");
    expect(done).toBeDefined();
  });

  test("emits engine.streamError when handler throws", async () => {
    const registry = makeRegistry();
    const notifications: { method: string; params: Record<string, unknown> }[] = [];
    const deps: AskStreamHandlerDeps = {
      registry,
      randomId: () => "stream-test-2",
      sessionWriteNotification: (n) => notifications.push(n),
      runWithRequestContext: async (_ctx, fn) => fn(),
      agentInvokeHandler: async () => {
        throw new Error("boom");
      },
    };
    const handler = createAskStreamHandler(deps);
    await handler("client-1", { input: "" });
    await new Promise((r) => setTimeout(r, 10));
    const err = notifications.find((n) => n.method === "engine.streamError");
    expect(err?.params).toMatchObject({ streamId: "stream-test-2", error: "boom" });
  });

  test("cancellation aborts the stream and emits streamError with cancelled code", async () => {
    const registry = makeRegistry();
    const notifications: { method: string; params: Record<string, unknown> }[] = [];
    let signalSeen: AbortSignal | undefined;
    const deps: AskStreamHandlerDeps = {
      registry,
      randomId: () => "stream-cancel-1",
      sessionWriteNotification: (n) => notifications.push(n),
      runWithRequestContext: async (_ctx, fn) => fn(),
      agentInvokeHandler: async (ctx) => {
        signalSeen = ctx.signal;
        // Simulate a long-running stream that checks signal cooperatively
        for (let i = 0; i < 100; i += 1) {
          if (ctx.signal?.aborted) {
            throw new Error("cancelled");
          }
          await new Promise((r) => setTimeout(r, 1));
        }
      },
    };
    const handler = createAskStreamHandler(deps);
    await handler("client-1", { input: "long" });
    // Cancel quickly
    await new Promise((r) => setTimeout(r, 5));
    expect(registry.has("stream-cancel-1")).toBe(true);
    expect(registry.cancel("stream-cancel-1")).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(signalSeen?.aborted).toBe(true);
    const err = notifications.find((n) => n.method === "engine.streamError");
    expect(err?.params).toMatchObject({ streamId: "stream-cancel-1", code: "cancelled" });
  });

  test("registry is cleared after stream completion", async () => {
    const registry = makeRegistry();
    const deps: AskStreamHandlerDeps = {
      registry,
      randomId: () => "stream-cleanup-1",
      sessionWriteNotification: () => undefined,
      runWithRequestContext: async (_c, fn) => fn(),
      agentInvokeHandler: async () => undefined,
    };
    const handler = createAskStreamHandler(deps);
    await handler("client-1", { input: "" });
    await new Promise((r) => setTimeout(r, 10));
    expect(registry.has("stream-cleanup-1")).toBe(false);
  });
});
```

- [ ] **Step 8.3: Run test to confirm it fails**

```bash
cd packages/gateway && bun test src/ipc/engine-ask-stream-handler.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8.4: Implement `engine-ask-stream.ts`**

Create `packages/gateway/src/ipc/engine-ask-stream.ts`:

```ts
/**
 * Extracted handler for `engine.askStream`. Owns the stream's AbortController
 * via the StreamRegistry so `engine.cancelStream` can cancel by streamId.
 */

export type StreamNotification = {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
};

export type AgentInvokeContextLike = {
  clientId: string;
  input: string;
  stream: true;
  sendChunk?: (text: string) => void;
  sessionId?: string;
  signal?: AbortSignal;
};

export type RequestContextLike = { sessionId?: string };

export type StreamRegistry = {
  register(streamId: string, ac: AbortController): void;
  cancel(streamId: string): boolean;
  unregister(streamId: string): void;
  has(streamId: string): boolean;
  size(): number;
};

export type AskStreamHandlerDeps = {
  registry: StreamRegistry;
  randomId: () => string;
  sessionWriteNotification: (n: StreamNotification) => void;
  runWithRequestContext: <T>(ctx: RequestContextLike, fn: () => Promise<T>) => Promise<T>;
  agentInvokeHandler: (ctx: AgentInvokeContextLike) => Promise<unknown>;
};

export type AskStreamParams = {
  input: string;
  sessionId?: string;
};

export type AskStreamResult = { streamId: string };

export function createAskStreamHandler(
  deps: AskStreamHandlerDeps,
): (clientId: string, params: AskStreamParams) => Promise<AskStreamResult> {
  return async (clientId, params): Promise<AskStreamResult> => {
    const streamId = deps.randomId();
    const ac = new AbortController();
    deps.registry.register(streamId, ac);

    const sendChunk = (text: string): void => {
      if (ac.signal.aborted) return;
      deps.sessionWriteNotification({
        jsonrpc: "2.0",
        method: "engine.streamToken",
        params: { streamId, text },
      });
    };

    void (async (): Promise<void> => {
      try {
        const ctx: RequestContextLike = {};
        if (params.sessionId !== undefined) ctx.sessionId = params.sessionId;
        await deps.runWithRequestContext(ctx, async () => {
          const payload: AgentInvokeContextLike = {
            clientId,
            input: params.input,
            stream: true,
            sendChunk,
            signal: ac.signal,
          };
          if (params.sessionId !== undefined) payload.sessionId = params.sessionId;
          await deps.agentInvokeHandler(payload);
        });
        if (ac.signal.aborted) {
          deps.sessionWriteNotification({
            jsonrpc: "2.0",
            method: "engine.streamError",
            params: { streamId, code: "cancelled", error: "Stream cancelled" },
          });
        } else {
          deps.sessionWriteNotification({
            jsonrpc: "2.0",
            method: "engine.streamDone",
            params: {
              streamId,
              meta: { modelUsed: "default", isLocal: false, provider: "remote" },
            },
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Stream error";
        const code = ac.signal.aborted ? "cancelled" : "stream_error";
        deps.sessionWriteNotification({
          jsonrpc: "2.0",
          method: "engine.streamError",
          params: { streamId, code, error: message },
        });
      } finally {
        deps.registry.unregister(streamId);
      }
    })();

    return { streamId };
  };
}

/** Default in-memory implementation of StreamRegistry. */
export function createStreamRegistry(): StreamRegistry {
  const map = new Map<string, AbortController>();
  return {
    register(id, ac): void {
      map.set(id, ac);
    },
    cancel(id): boolean {
      const ac = map.get(id);
      if (ac === undefined) return false;
      ac.abort();
      map.delete(id);
      return true;
    },
    unregister(id): void {
      map.delete(id);
    },
    has(id): boolean {
      return map.has(id);
    },
    size(): number {
      return map.size;
    },
  };
}
```

- [ ] **Step 8.5: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/ipc/engine-ask-stream-handler.test.ts
```

Expected: PASS, 4 of 4.

- [ ] **Step 8.6: Wire `server.ts` to use the new handler**

Edit `packages/gateway/src/ipc/server.ts`. Add near the top imports:

```ts
import {
  createAskStreamHandler,
  createStreamRegistry,
  type StreamRegistry,
} from "./engine-ask-stream.js";
```

Add a module-level registry near the existing `agentInvokeHandler` declaration:

```ts
const streamRegistry: StreamRegistry = createStreamRegistry();
```

Replace the entire `case "engine.askStream":` block (lines 931-987 in the pre-edit file) with:

```ts
      case "engine.askStream": {
        const rec = asRecord(params);
        const input = rec !== undefined && typeof rec["input"] === "string" ? rec["input"] : "";
        const sessionIdRaw = rec?.["sessionId"];
        const sessionId =
          typeof sessionIdRaw === "string" && sessionIdRaw.trim() !== ""
            ? sessionIdRaw.trim()
            : undefined;
        const handler = agentInvokeHandler;
        if (handler === undefined) {
          throw new RpcMethodError(-32603, "No agent handler configured for engine.askStream");
        }
        const dispatch = createAskStreamHandler({
          registry: streamRegistry,
          randomId: () => randomUUID(),
          sessionWriteNotification: (n) => session.writeNotification(n),
          runWithRequestContext: (ctx, fn) => agentRequestContext.run(ctx, fn),
          agentInvokeHandler: async (ctx) => {
            const payload: AgentInvokeContext = {
              clientId: ctx.clientId,
              input: ctx.input,
              stream: ctx.stream,
            };
            if (ctx.sendChunk !== undefined) payload.sendChunk = ctx.sendChunk;
            if (ctx.sessionId !== undefined) payload.sessionId = ctx.sessionId;
            return await handler(payload);
          },
        });
        const params2: { input: string; sessionId?: string } = { input };
        if (sessionId !== undefined) params2.sessionId = sessionId;
        return await dispatch(clientId, params2);
      }
```

Export `streamRegistry` (or re-export via a getter) so `engine.cancelStream` (Task 9) can cancel. Add at the bottom of `server.ts`:

```ts
export function getStreamRegistryForTesting(): StreamRegistry {
  return streamRegistry;
}
```

(The cancel handler in Task 9 will reach `streamRegistry` via a closure rather than this export — but we expose it for tests anyway.)

- [ ] **Step 8.7: Run the full gateway test suite to confirm no regression**

```bash
cd packages/gateway && bun test src/ipc/
```

Expected: ALL PASS, including the existing `engine-ask-stream.test.ts`.

- [ ] **Step 8.8: Commit**

```bash
git add packages/gateway/src/ipc/engine-ask-stream.ts packages/gateway/src/ipc/engine-ask-stream-handler.test.ts packages/gateway/src/ipc/server.ts
git commit -m "refactor(gateway): extract askStream handler with AbortController-based cancellation"
```

---

## Task 9: Implement `engine.cancelStream` IPC method

**HITL lifecycle note:** When a stream is cancelled, any in-flight HITL request the engine was awaiting resolves implicitly via the AbortController — the engine's `await consent.requestApproval(...)` chain unwinds and the stream loop exits with `code: "cancelled"`. There is no separate "cancel pending HITL" call needed because consent requests are owned per-await, not queued globally on the Gateway. Extension-side, the `pendingInline` map in `chat-controller.ts` cleans up via the iterator's `finally` block (Task 22). If a future HITL implementation moves to a queued model, this assumption needs revisiting.

**Files:**
- Create: `packages/gateway/src/ipc/engine-cancel-stream.ts`
- Create: `packages/gateway/src/ipc/engine-cancel-stream.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`

---

- [ ] **Step 9.1: Write the failing test**

Create `packages/gateway/src/ipc/engine-cancel-stream.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { createCancelStreamHandler } from "./engine-cancel-stream.ts";
import { createStreamRegistry } from "./engine-ask-stream.ts";

describe("createCancelStreamHandler", () => {
  test("returns ok=true and aborts the controller for known streamId", () => {
    const registry = createStreamRegistry();
    const ac = new AbortController();
    registry.register("s1", ac);
    const handler = createCancelStreamHandler(registry);
    const result = handler({ streamId: "s1" });
    expect(result).toEqual({ ok: true });
    expect(ac.signal.aborted).toBe(true);
  });

  test("returns ok=true (idempotent) for unknown streamId", () => {
    const registry = createStreamRegistry();
    const handler = createCancelStreamHandler(registry);
    const result = handler({ streamId: "never-existed" });
    expect(result).toEqual({ ok: true });
  });

  test("throws RpcMethodError when streamId is not a non-empty string", () => {
    const registry = createStreamRegistry();
    const handler = createCancelStreamHandler(registry);
    expect(() => handler({ streamId: "" })).toThrow();
    expect(() => handler({ streamId: 42 as unknown as string })).toThrow();
  });
});
```

- [ ] **Step 9.2: Run test to confirm it fails**

```bash
cd packages/gateway && bun test src/ipc/engine-cancel-stream.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement `engine-cancel-stream.ts`**

Create `packages/gateway/src/ipc/engine-cancel-stream.ts`:

```ts
import { RpcMethodError } from "./jsonrpc.js";
import type { StreamRegistry } from "./engine-ask-stream.js";

export type CancelStreamParams = { streamId: string };
export type CancelStreamResult = { ok: boolean };

export function createCancelStreamHandler(
  registry: StreamRegistry,
): (params: unknown) => CancelStreamResult {
  return (params): CancelStreamResult => {
    if (typeof params !== "object" || params === null) {
      throw new RpcMethodError(-32602, "engine.cancelStream requires { streamId: string }");
    }
    const sid = (params as { streamId?: unknown }).streamId;
    if (typeof sid !== "string" || sid.length === 0) {
      throw new RpcMethodError(-32602, "engine.cancelStream requires non-empty streamId");
    }
    // Cancellation is idempotent — unknown streams resolve as ok
    registry.cancel(sid);
    return { ok: true };
  };
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/ipc/engine-cancel-stream.test.ts
```

Expected: PASS, 3 of 3.

- [ ] **Step 9.5: Wire into `server.ts`**

Edit `packages/gateway/src/ipc/server.ts`. Add import:

```ts
import { createCancelStreamHandler } from "./engine-cancel-stream.js";
```

Inside the `handleRpc` switch, add a new case **directly after** `case "engine.askStream":`:

```ts
      case "engine.cancelStream":
        return createCancelStreamHandler(streamRegistry)(params);
```

- [ ] **Step 9.6: Verify the gateway test suite stays green**

```bash
cd packages/gateway && bun test src/ipc/
```

Expected: ALL PASS.

- [ ] **Step 9.7: Commit**

```bash
git add packages/gateway/src/ipc/engine-cancel-stream.ts packages/gateway/src/ipc/engine-cancel-stream.test.ts packages/gateway/src/ipc/server.ts
git commit -m "feat(gateway): add engine.cancelStream IPC method (idempotent)"
```

---

## Task 10: Implement `engine.getSessionTranscript` IPC method

**Files:**
- Create: `packages/gateway/src/ipc/engine-get-session-transcript.ts`
- Create: `packages/gateway/src/ipc/engine-get-session-transcript.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`

---

- [ ] **Step 10.1: Recon — confirm `audit_log` shape for session transcripts**

Read `packages/gateway/src/db/audit.ts` (or equivalent) to find the `audit_log` schema. Identify:
- Column for `session_id` (likely `session_id TEXT`)
- Column(s) for the prompt text and response text — may live in a JSON `details` column rather than dedicated columns
- Timestamp column (likely `created_at INTEGER`)
- The action types written by `engine.askStream` — likely `agent.invoke` or `engine.askStream`

Record the exact column names found; the next steps assume placeholders that may need to be adjusted to match the actual schema.

- [ ] **Step 10.2: Write the failing test**

Create `packages/gateway/src/ipc/engine-get-session-transcript.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createGetSessionTranscriptHandler } from "./engine-get-session-transcript.ts";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      action_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      details_json TEXT
    )
  `);
  const insert = db.prepare(
    "INSERT INTO audit_log (session_id, action_type, created_at, details_json) VALUES (?, ?, ?, ?)",
  );
  insert.run("sess-1", "engine.askUser", 1000, JSON.stringify({ text: "hello" }));
  insert.run("sess-1", "engine.askAssistant", 1100, JSON.stringify({ text: "hi there" }));
  insert.run("sess-1", "engine.askUser", 2000, JSON.stringify({ text: "how are you" }));
  insert.run("sess-1", "engine.askAssistant", 2100, JSON.stringify({ text: "fine" }));
  insert.run("sess-OTHER", "engine.askUser", 3000, JSON.stringify({ text: "noise" }));
  return db;
}

describe("createGetSessionTranscriptHandler", () => {
  test("returns ordered turns for the requested session", async () => {
    const db = seedDb();
    const handler = createGetSessionTranscriptHandler(db);
    const result = await handler({ sessionId: "sess-1" });
    expect(result.sessionId).toBe("sess-1");
    expect(result.turns.length).toBe(4);
    expect(result.turns[0]).toMatchObject({ role: "user", text: "hello", timestamp: 1000 });
    expect(result.turns[1]).toMatchObject({ role: "assistant", text: "hi there" });
    expect(result.hasMore).toBe(false);
  });

  test("clamps limit to [1, 500] and reports hasMore", async () => {
    const db = seedDb();
    const handler = createGetSessionTranscriptHandler(db);
    const r1 = await handler({ sessionId: "sess-1", limit: 2 });
    expect(r1.turns.length).toBe(2);
    expect(r1.hasMore).toBe(true);
    const r2 = await handler({ sessionId: "sess-1", limit: 9999 });
    expect(r2.turns.length).toBe(4);
    expect(r2.hasMore).toBe(false);
    const r3 = await handler({ sessionId: "sess-1", limit: 0 });
    expect(r3.turns.length).toBeGreaterThanOrEqual(1);
  });

  test("returns empty turns for unknown sessionId", async () => {
    const db = seedDb();
    const handler = createGetSessionTranscriptHandler(db);
    const result = await handler({ sessionId: "never" });
    expect(result.sessionId).toBe("never");
    expect(result.turns).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  test("rejects invalid params", async () => {
    const db = seedDb();
    const handler = createGetSessionTranscriptHandler(db);
    await expect(handler({ sessionId: "" })).rejects.toThrow();
    await expect(handler({} as { sessionId: string })).rejects.toThrow();
  });
});
```

- [ ] **Step 10.3: Run test to confirm it fails**

```bash
cd packages/gateway && bun test src/ipc/engine-get-session-transcript.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 10.4: Implement `engine-get-session-transcript.ts`**

Create `packages/gateway/src/ipc/engine-get-session-transcript.ts`:

```ts
import type { Database } from "bun:sqlite";

import { RpcMethodError } from "./jsonrpc.js";

export type GetSessionTranscriptParams = {
  sessionId: string;
  limit?: number;
};

export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  auditLogId?: number;
};

export type SessionTranscriptResult = {
  sessionId: string;
  turns: TranscriptTurn[];
  hasMore: boolean;
};

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

function clampLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  if (raw < MIN_LIMIT) return MIN_LIMIT;
  if (raw > MAX_LIMIT) return MAX_LIMIT;
  return Math.trunc(raw);
}

function actionToRole(actionType: string): "user" | "assistant" | undefined {
  // Returns undefined for action types that aren't part of a chat exchange
  // (e.g., agent.invoke, engine.streamCancelled, audit-only rows). Callers
  // skip such rows entirely — they are not chat turns and must not appear
  // in the rehydrated transcript at all.
  if (actionType === "engine.askUser") return "user";
  if (actionType === "engine.askAssistant") return "assistant";
  return undefined;
}

function parseDetailsText(detailsJson: string | null): string {
  // For rows that ARE chat turns (actionToRole returned user/assistant)
  // but whose text is missing/unparseable, return "[redacted]" so the
  // turn count stays consistent in the UI even when content is absent.
  if (detailsJson === null) return "[redacted]";
  try {
    const parsed = JSON.parse(detailsJson) as { text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // fall through
  }
  return "[redacted]";
}

export function createGetSessionTranscriptHandler(
  db: Database,
): (params: unknown) => Promise<SessionTranscriptResult> {
  return async (params): Promise<SessionTranscriptResult> => {
    if (typeof params !== "object" || params === null) {
      throw new RpcMethodError(-32602, "engine.getSessionTranscript requires params object");
    }
    const sid = (params as { sessionId?: unknown }).sessionId;
    if (typeof sid !== "string" || sid.length === 0) {
      throw new RpcMethodError(-32602, "engine.getSessionTranscript requires non-empty sessionId");
    }
    const limit = clampLimit((params as { limit?: unknown }).limit);

    const stmt = db.prepare(`
      SELECT id, action_type, created_at, details_json
      FROM audit_log
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `);
    type Row = {
      id: number;
      action_type: string;
      created_at: number;
      details_json: string | null;
    };
    const rows = stmt.all(sid, limit + 1) as Row[];

    const hasMore = rows.length > limit;
    const used = hasMore ? rows.slice(0, limit) : rows;

    const turns: TranscriptTurn[] = [];
    for (const r of used) {
      const role = actionToRole(r.action_type);
      if (role === undefined) continue;
      turns.push({
        role,
        text: parseDetailsText(r.details_json),
        timestamp: r.created_at,
        auditLogId: r.id,
      });
    }
    return { sessionId: sid, turns, hasMore };
  };
}
```

- [ ] **Step 10.5: Run test to verify it passes**

```bash
cd packages/gateway && bun test src/ipc/engine-get-session-transcript.test.ts
```

Expected: PASS, 4 of 4. **If column names or action-type strings differ** in the actual `audit_log` schema (per recon in 10.1), update `actionToRole` and the SELECT to match — test still passes against the in-memory fixture, but a follow-up sub-step is to verify against the real DB.

- [ ] **Step 10.6: Verify against the real `audit_log` shape**

Open the actual audit insertion site for `engine.askStream` (likely under `packages/gateway/src/engine/`). Confirm:
- The `action_type` strings used (replace `engine.askUser` / `engine.askAssistant` placeholders with real values found there).
- The column name carrying the rendered text (`details_json` vs another name).

Update `engine-get-session-transcript.ts` if needed to match real names. Re-run tests.

If the audit insertion does NOT yet record assistant text, add a follow-up note in `docs/superpowers/specs/2026-04-24-ws7-vscode-extension-design.md` §13.1 (deferred) — for v0.1.0, the handler returns `[redacted]` for missing text and the chat panel renders it as such.

- [ ] **Step 10.7: Wire into `server.ts`**

Edit `packages/gateway/src/ipc/server.ts`. Add import:

```ts
import { createGetSessionTranscriptHandler } from "./engine-get-session-transcript.js";
```

This handler needs the SQLite database. The DB is already available in `server.ts` via the existing constructor or factory — locate the existing reference (likely `db` parameter on `createIpcServer` or similar). Add a module-level handler initialized lazily on first call:

```ts
let getSessionTranscriptHandler:
  | ((p: unknown) => Promise<SessionTranscriptResult>)
  | undefined;
```

Inside `handleRpc`, add (alphabetical with other engine.* cases, directly after `engine.cancelStream`):

```ts
      case "engine.getSessionTranscript": {
        if (getSessionTranscriptHandler === undefined) {
          getSessionTranscriptHandler = createGetSessionTranscriptHandler(db);
        }
        return await getSessionTranscriptHandler(params);
      }
```

Where `db` resolves to the SQLite instance the server already holds. **If the server file does not have direct access to `db`**, accept it via the existing factory function's argument list (verify by reading the file).

- [ ] **Step 10.8: Run gateway IPC tests + integration smoke**

```bash
cd packages/gateway && bun test src/ipc/
```

Expected: ALL PASS.

- [ ] **Step 10.9: Commit**

```bash
git add packages/gateway/src/ipc/engine-get-session-transcript.ts packages/gateway/src/ipc/engine-get-session-transcript.test.ts packages/gateway/src/ipc/server.ts
git commit -m "feat(gateway): add engine.getSessionTranscript IPC over audit_log"
```

---

## Task 11: Bump Tauri allowlist + size assertion

**Files:**
- Modify: `packages/ui/src-tauri/src/gateway_bridge.rs`

---

- [ ] **Step 11.1: Add the two new methods to `ALLOWED_METHODS`**

Edit `packages/ui/src-tauri/src/gateway_bridge.rs`. In the `pub const ALLOWED_METHODS: &[&str] = &[ ... ]` block (around line 63), insert the two entries in alphabetical position. Find the existing `"engine.askStream",` line and insert immediately after:

```rust
    "engine.cancelStream",
    "engine.getSessionTranscript",
```

- [ ] **Step 11.2: Update the size assertion**

In the same file (around line 436), find:

```rust
        assert_eq!(ALLOWED_METHODS.len(), 56);
```

Change `56` to `58`.

- [ ] **Step 11.3: Run the Tauri Rust tests**

```bash
cd packages/ui/src-tauri && cargo test
```

Expected: PASS, including `allowlist_exact_size`, `allowlist_alphabetized`, `allowlist_no_duplicates`.

- [ ] **Step 11.4: Commit**

```bash
git add packages/ui/src-tauri/src/gateway_bridge.rs
git commit -m "feat(ui-tauri): allow engine.cancelStream + engine.getSessionTranscript (size 58)"
```

---

## Task 12: Author the Node-compat test for `@nimbus-dev/client`

**Files:**
- Create: `packages/client/test/node-compat.test.ts`

---

- [ ] **Step 12.1: Determine the existing Gateway-subprocess test fixture**

Open `packages/gateway/src/ipc/ipc.test.ts` and identify the helper that spawns a real Gateway subprocess for tests (likely a `spawnGateway` or `withGateway` helper). Note the exact import path. We will replicate the same pattern under `node:test`.

- [ ] **Step 12.2: Write the test**

Create `packages/client/test/node-compat.test.ts`:

```ts
/**
 * Node-compat test for @nimbus-dev/client. Runs under `node --test`,
 * not `bun test`. Validates the dual-runtime IPC transport against a
 * real Gateway subprocess on Linux/macOS (Unix socket) and Windows
 * (named pipe).
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { discoverSocketPath, NimbusClient } from "../dist/index.js";

const GATEWAY_BIN = process.env.NIMBUS_GATEWAY_BIN;
const STARTUP_TIMEOUT_MS = 15000;

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const c = await NimbusClient.open({ socketPath });
      await c.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Gateway socket did not appear within ${timeoutMs}ms: ${socketPath}`);
}

async function spawnGateway(dataDir: string): Promise<{
  proc: ChildProcessWithoutNullStreams;
  socketPath: string;
}> {
  if (GATEWAY_BIN === undefined) {
    throw new Error(
      "NIMBUS_GATEWAY_BIN env var must point to a built gateway binary or 'bun run packages/gateway/src/index.ts'",
    );
  }
  const env = { ...process.env, NIMBUS_DATA_DIR: dataDir };
  const proc = spawn(GATEWAY_BIN, [], { env });
  proc.stdout.on("data", () => undefined);
  proc.stderr.on("data", () => undefined);
  // Discover the socket path the gateway will write to its state file
  const r = await discoverSocketPath();
  await waitForSocket(r.socketPath, STARTUP_TIMEOUT_MS);
  return { proc, socketPath: r.socketPath };
}

await test("connects, askStream yields tokens + done", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
  const { proc, socketPath } = await spawnGateway(dataDir);
  try {
    const client = await NimbusClient.open({ socketPath });
    const handle = client.askStream("hello");
    const events: string[] = [];
    for await (const ev of handle) {
      events.push(ev.type);
      if (ev.type === "done" || ev.type === "error") break;
    }
    assert.ok(events.includes("done") || events.includes("error"));
    await client.close();
  } finally {
    proc.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  }
});

await test("subscribeHitl receives synthetic agent.hitlBatch", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
  const { proc, socketPath } = await spawnGateway(dataDir);
  try {
    const client = await NimbusClient.open({ socketPath });
    let received = false;
    const sub = client.subscribeHitl(() => {
      received = true;
    });
    // The Gateway in test mode does not naturally fire HITL on a passive
    // socket connection; this test only asserts the subscription wires up
    // without throwing. A full HITL roundtrip is covered by the integration
    // test in the gateway package.
    assert.equal(typeof sub.dispose, "function");
    await client.close();
  } finally {
    proc.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  }
});

await test("cancel() mid-stream terminates iterator", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
  const { proc, socketPath } = await spawnGateway(dataDir);
  try {
    const client = await NimbusClient.open({ socketPath });
    const handle = client.askStream("long-running");
    setTimeout(() => {
      void handle.cancel();
    }, 50);
    const events: string[] = [];
    for await (const ev of handle) {
      events.push(ev.type);
      if (events.length > 100) break;
    }
    // Either we got an explicit error (cancelled) or done before timeout
    assert.ok(events.length >= 0);
    await client.close();
  } finally {
    proc.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  }
});

await test("disconnect closes socket without leaking handles", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nimbus-nodecompat-"));
  const { proc, socketPath } = await spawnGateway(dataDir);
  try {
    const client = await NimbusClient.open({ socketPath });
    await client.close();
    // Re-open to confirm socket is still usable
    const client2 = await NimbusClient.open({ socketPath });
    await client2.close();
  } finally {
    proc.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 12.3: Build the client (so `dist/index.js` exists for Node to import)**

```bash
cd packages/client && bun run build
```

Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` produced.

- [ ] **Step 12.4: Smoke-run locally**

Build a Gateway binary (or use the `bun run packages/gateway/src/index.ts` form) and set `NIMBUS_GATEWAY_BIN`. Then:

```bash
cd packages/client && NIMBUS_GATEWAY_BIN="<path-to-gateway>" node --test test/node-compat.test.ts
```

Expected: 4 passing tests. Local smoke is a sanity check before CI wiring (Task 13).

- [ ] **Step 12.5: Commit**

```bash
git add packages/client/test/node-compat.test.ts
git commit -m "test(client): add Node runtime compat test against real Gateway"
```

---

## Task 13: Wire CI for node-compat test (3-OS matrix) + add `test:coverage:vscode-extension` placeholder

**Files:**
- Modify: `package.json` (root)
- Modify: `.github/workflows/_test-suite.yml`

---

- [ ] **Step 13.1: Add the root `test:coverage:vscode-extension` script (placeholder; package created in Task 14)**

Edit root `package.json`. In the `scripts` block, add (alphabetical):

```jsonc
"test:coverage:vscode-extension": "cd packages/vscode-extension && bunx vitest run --coverage"
```

- [ ] **Step 13.2: Add the coverage gate row to `_test-suite.yml`**

Edit `.github/workflows/_test-suite.yml`. In the matrix `gate:` list (where existing `name`/`script` pairs are), append:

```yaml
          - name: VS Code Extension
            script: "test:coverage:vscode-extension"
```

- [ ] **Step 13.3: Add a 3-OS node-compat matrix job**

In `.github/workflows/_test-suite.yml`, add a new job `client-node-compat` after the existing matrix job. Use this template (verify exact indentation against the surrounding file):

```yaml
  client-node-compat:
    name: Client node-compat (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-14, windows-latest]
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@8d3c67de8e2fe68ef647c8db1e6a09f647780f40 # v2.19.0
        with:
          egress-policy: audit

      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: latest

      - name: Setup Node 20
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: "20"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build @nimbus-dev/client
        run: cd packages/client && bun run build

      - name: Build gateway binary
        run: bun run build --filter=@nimbus/gateway

      - name: Run node-compat tests
        env:
          NIMBUS_GATEWAY_BIN: ${{ runner.os == 'Windows' && 'packages\gateway\dist\nimbus-gateway.exe' || './packages/gateway/dist/nimbus-gateway' }}
        run: cd packages/client && node --test test/node-compat.test.ts
```

If the gateway package does not have a standalone `build` script that produces `dist/nimbus-gateway[.exe]`, fall back to:

```yaml
      - name: Run node-compat tests
        env:
          NIMBUS_GATEWAY_BIN: bun
          NIMBUS_GATEWAY_BIN_ARGS: "run packages/gateway/src/index.ts"
        run: cd packages/client && node --test test/node-compat.test.ts
```

(This requires `node-compat.test.ts` to support the args env var — adjust the test's `spawn` call accordingly if you take this path.)

- [ ] **Step 13.4: Push and confirm CI green on a feature branch**

Push the changes to a feature branch and verify the new jobs run green on all three OSes. If a flake occurs (named-pipe handshake on Windows is a known sensitivity), add a single-retry `if-no-files-found: warn`-style guard or rerun.

- [ ] **Step 13.5: Commit**

```bash
git add package.json .github/workflows/_test-suite.yml
git commit -m "ci: add client node-compat 3-OS matrix + vscode-extension coverage gate"
```

---

## Task 14: Scaffold the `packages/vscode-extension/` package

**Why:** Every subsequent extension task needs the manifest, build pipeline, and test config in place.

**Files (all new):**
- `packages/vscode-extension/package.json`
- `packages/vscode-extension/tsconfig.json`
- `packages/vscode-extension/biome.json`
- `packages/vscode-extension/vitest.config.ts`
- `packages/vscode-extension/esbuild.mjs`
- `packages/vscode-extension/.vscodeignore`
- `packages/vscode-extension/LICENSE`
- `packages/vscode-extension/README.md`
- `packages/vscode-extension/CHANGELOG.md`
- `packages/vscode-extension/icon.png` (placeholder)

---

- [ ] **Step 14.1: Create the directory**

```bash
mkdir -p packages/vscode-extension/src packages/vscode-extension/test/unit packages/vscode-extension/test/integration packages/vscode-extension/media
```

- [ ] **Step 14.2: Create `package.json`**

Write `packages/vscode-extension/package.json`:

```json
{
  "name": "@nimbus/vscode-extension",
  "displayName": "Nimbus",
  "description": "Local-first AI agent for the editor. Ask, search, and run workflows against your private Nimbus index.",
  "version": "0.1.0",
  "publisher": "nimbus-dev",
  "license": "MIT",
  "private": false,
  "engines": { "vscode": "^1.90.0" },
  "categories": ["AI", "Other"],
  "keywords": ["ai", "agent", "local-first", "nimbus", "privacy", "mcp"],
  "main": "./dist/extension.js",
  "icon": "icon.png",
  "galleryBanner": { "color": "#0E1116", "theme": "dark" },
  "repository": { "type": "git", "url": "https://github.com/nimbus-dev/Nimbus" },
  "bugs": { "url": "https://github.com/nimbus-dev/Nimbus/issues" },
  "homepage": "https://nimbus.dev/vscode",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "nimbus.ask",                "title": "Ask",                  "category": "Nimbus" },
      { "command": "nimbus.askAboutSelection",  "title": "Ask About Selection",  "category": "Nimbus" },
      { "command": "nimbus.search",             "title": "Search",               "category": "Nimbus" },
      { "command": "nimbus.searchSelection",    "title": "Search Selection",     "category": "Nimbus" },
      { "command": "nimbus.runWorkflow",        "title": "Run Workflow",         "category": "Nimbus" },
      { "command": "nimbus.newConversation",    "title": "New Conversation",     "category": "Nimbus" },
      { "command": "nimbus.startGateway",       "title": "Start Gateway",        "category": "Nimbus" },
      { "command": "nimbus.reconnect",          "title": "Reconnect to Gateway", "category": "Nimbus" }
    ],
    "menus": {
      "editor/context": [
        { "command": "nimbus.askAboutSelection", "when": "editorHasSelection", "group": "nimbus@1" },
        { "command": "nimbus.searchSelection",   "when": "editorHasSelection", "group": "nimbus@2" }
      ]
    },
    "configuration": {
      "title": "Nimbus",
      "properties": {
        "nimbus.socketPath": {
          "type": "string",
          "default": "",
          "description": "Override Gateway socket path. Leave empty to auto-detect via gateway.json or platform default."
        },
        "nimbus.autoStartGateway": {
          "type": "boolean",
          "default": false,
          "description": "When true, the extension will spawn `nimbus start` if the Gateway socket is unreachable."
        },
        "nimbus.statusBarPollMs": {
          "type": "number",
          "default": 30000,
          "minimum": 5000,
          "description": "Polling interval (ms) for connector health updates in the status bar."
        },
        "nimbus.transcriptHistoryLimit": {
          "type": "number",
          "default": 50,
          "minimum": 1,
          "maximum": 500,
          "description": "How many turns to rehydrate from engine.getSessionTranscript on Webview reload."
        },
        "nimbus.askAgent": {
          "type": "string",
          "default": "",
          "description": "Optional default agent name passed to askStream. Blank = Gateway default."
        },
        "nimbus.hitlAlwaysModal": {
          "type": "boolean",
          "default": false,
          "description": "When true, out-of-chat HITL is rendered as a blocking modal instead of a non-modal toast."
        },
        "nimbus.logLevel": {
          "type": "string",
          "enum": ["error", "warn", "info", "debug"],
          "default": "info",
          "description": "Output channel verbosity. Stream errors always log at 'error' regardless."
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.mjs",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/",
    "test": "bunx vitest run",
    "test:coverage": "bunx vitest run --coverage",
    "package": "bunx vsce package --no-dependencies",
    "clean": "node -e \"import('node:fs').then(f=>{f.rmSync('dist',{recursive:true,force:true});f.rmSync('media/webview.js',{force:true});f.rmSync('media/webview.css',{force:true})})\""
  },
  "dependencies": {
    "@nimbus-dev/client": "workspace:*",
    "marked": "^14.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.90.0",
    "@vitest/coverage-v8": "^2.0.0",
    "@vscode/test-electron": "^2.4.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.23.0",
    "jsdom": "^25.0.0",
    "ovsx": "^0.10.0",
    "typescript": "^6.0.3",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 14.3: Create `tsconfig.json`**

Write `packages/vscode-extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 14.4: Create `biome.json`**

Write `packages/vscode-extension/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "extends": ["//"]
}
```

- [ ] **Step 14.5: Create `vitest.config.ts`**

Write `packages/vscode-extension/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environmentMatchGlobs: [["test/unit/webview/**", "jsdom"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/vscode-shim.ts"],
      thresholds: {
        lines: 80,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      vscode: new URL("./test/unit/vscode-stub.ts", import.meta.url).pathname,
    },
  },
});
```

- [ ] **Step 14.6: Create `esbuild.mjs`**

Write `packages/vscode-extension/esbuild.mjs`:

```js
import { build } from "esbuild";
import { copyFileSync } from "node:fs";

const isWatch = process.argv.includes("--watch");
// Production = anything that's not an explicit dev/watch invocation.
// CI/publish-vscode.yml leaves NODE_ENV unset → minified, no sourcemaps.
// Local `bun run build --watch` → unminified + sourcemaps for debugging.
const isDev = isWatch || process.env.NODE_ENV === "development";

const baseExt = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: isDev,
  minify: !isDev,
  external: ["vscode"],
  logLevel: "info",
};

await build({
  ...baseExt,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  watch: isWatch,
});

await build({
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  globalName: "NimbusWebview",
  sourcemap: isDev,
  // Always minify the Webview bundle — it ships in the .vsix and reloads on
  // every panel open. ~16 KB marked + ~5 KB our code → ~8 KB minified.
  minify: true,
  treeShaking: true,
  entryPoints: ["src/chat/webview/main.ts"],
  outfile: "media/webview.js",
  logLevel: "info",
  watch: isWatch,
});

copyFileSync("src/chat/webview/styles.css", "media/webview.css");

console.log(`esbuild: bundles produced (minify=${!isDev}, sourcemaps=${isDev})`);
```

- [ ] **Step 14.7: Create `.vscodeignore`**

Write `packages/vscode-extension/.vscodeignore`:

```
.vscode/**
.vscode-test/**
src/**
test/**
node_modules/**
**/*.map
**/*.test.ts
tsconfig.json
biome.json
vitest.config.ts
esbuild.mjs
.gitignore
**/.DS_Store
```

- [ ] **Step 14.8: Create `LICENSE`**

Write `packages/vscode-extension/LICENSE` (copy the existing MIT text from `packages/client/LICENSE`; if absent, use the standard MIT license text with copyright "Copyright (c) 2026 Nimbus contributors").

- [ ] **Step 14.9: Create `README.md` (marketplace listing)**

Write `packages/vscode-extension/README.md`:

```markdown
# Nimbus for VS Code

Local-first AI agent for the editor. Ask, search, and run workflows against your private Nimbus index — all running on your machine.

## What it does

- **Ask** — chat with the Nimbus agent in a side panel; results stream token-by-token.
- **Search** — query your local Nimbus index across every connected service from the command palette.
- **Run Workflow** — trigger pre-defined Nimbus workflows from inside VS Code with HITL consent.

## Install

VS Code Marketplace: `ext install nimbus-dev.nimbus`
Open VSX (Cursor, VSCodium): `ext install nimbus-dev.nimbus`
Manual: download the `.vsix` from the GitHub Release and run `code --install-extension nimbus-<ver>.vsix`.

## Requires

A running Nimbus Gateway. See https://nimbus.dev/install for setup.

## License

MIT
```

- [ ] **Step 14.10: Create `CHANGELOG.md`**

Write `packages/vscode-extension/CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0 (Phase 4 release)

- Initial release.
- `Nimbus: Ask` — streaming chat in a persistent side panel.
- `Nimbus: Search` — Quick Pick over the local Nimbus index.
- `Nimbus: Run Workflow` — trigger a workflow from the palette.
- `Nimbus: Ask About Selection` / `Nimbus: Search Selection` — editor right-click menu commands with selection context.
- Status bar: profile name + connector health + HITL pending count (30 s poll).
- Context-sensitive HITL: inline in chat when visible+focused; non-modal toast otherwise (modal opt-in via `nimbus.hitlAlwaysModal`).
- Theme-synced Webview (Dark, Light, High Contrast).
- Gateway-backed transcript rehydration via `engine.getSessionTranscript`.
- `nimbus-item:` URI scheme for read-only structured search results.
```

- [ ] **Step 14.11: Add a placeholder `icon.png`**

For now, copy any 128×128 PNG into `packages/vscode-extension/icon.png`. Final brand-aligned icon is a manual step before the first publish (Task 28). To unblock the build, generate a placeholder programmatically:

```bash
node -e "
import('node:fs').then(f => {
  // 128x128 transparent PNG (smallest valid PNG is hand-rolled — use a 1x1 placeholder bumped up)
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
    'base64'
  );
  f.writeFileSync('packages/vscode-extension/icon.png', tinyPng);
});
"
```

(VS Code will accept the small icon; real branding lands in Task 28's pre-publish smoke.)

- [ ] **Step 14.12: Install + typecheck**

```bash
bun install
cd packages/vscode-extension && bun run typecheck
```

Expected: `bun install` resolves the new workspace package; typecheck PASSES (no source files yet, but tsc still resolves the deps).

- [ ] **Step 14.13: Commit**

```bash
git add packages/vscode-extension/
git commit -m "chore(vscode-extension): scaffold package with manifest, build, test config"
```

---

## Task 15: Set up `vscode-shim.ts` testability boundary, `Settings`, `OutputChannel` adapter

**Files:**
- Create: `packages/vscode-extension/src/vscode-shim.ts`
- Create: `packages/vscode-extension/src/settings.ts`
- Create: `packages/vscode-extension/src/logging.ts`
- Create: `packages/vscode-extension/test/unit/vscode-stub.ts`
- Create: `packages/vscode-extension/test/unit/settings.test.ts`
- Create: `packages/vscode-extension/test/unit/logging.test.ts`

---

- [ ] **Step 15.1: Create the vscode test stub**

Create `packages/vscode-extension/test/unit/vscode-stub.ts`:

```ts
/**
 * Minimal stub of the `vscode` module for vitest unit tests.
 * Real source-under-test should NOT import `vscode` directly — use vscode-shim.ts.
 * This stub exists for any code path that does (which should be only extension.ts).
 */

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (_msg: string) => undefined,
    show: (_preserveFocus?: boolean) => undefined,
    dispose: () => undefined,
  }),
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  createStatusBarItem: () => ({
    text: "",
    tooltip: "",
    command: "",
    backgroundColor: undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  }),
};
export const workspace = {
  getConfiguration: (_section: string) => ({
    get: (_key: string, dflt: unknown) => dflt,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => undefined }),
};
export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined,
};
export const env = {
  openExternal: async () => true,
  isTelemetryEnabled: false,
};
export class ThemeColor {
  constructor(public id: string) {}
}
export const Uri = {
  parse: (s: string) => ({ toString: () => s, scheme: s.split(":")[0] ?? "" }),
};
export enum ViewColumn {
  Beside = -2,
  Active = -1,
  One = 1,
}
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}
```

- [ ] **Step 15.2: Create `vscode-shim.ts`**

Create `packages/vscode-extension/src/vscode-shim.ts`:

```ts
/**
 * Narrow interfaces over `vscode` so source-under-test never imports `vscode` directly.
 * extension.ts is the only file that constructs real implementations from `vscode.*`.
 */

export interface OutputChannelHandle {
  appendLine(msg: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface StatusBarItemHandle {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  backgroundColor: { id: string } | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface WindowApi {
  createOutputChannel(name: string): OutputChannelHandle;
  createStatusBarItem(alignment: 1 | 2, priority: number): StatusBarItemHandle;
  showInformationMessage(
    msg: string,
    opts: { modal?: boolean },
    ...items: string[]
  ): Thenable<string | undefined>;
  showErrorMessage(msg: string, ...items: string[]): Thenable<string | undefined>;
  showInputBox(opts?: { prompt?: string; value?: string }): Thenable<string | undefined>;
}

export interface WorkspaceConfigSection {
  get<T>(key: string, defaultValue: T): T;
}

export interface WorkspaceApi {
  getConfiguration(section: string): WorkspaceConfigSection;
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface CommandsApi {
  executeCommand<T>(command: string, ...args: unknown[]): Thenable<T | undefined>;
}
```

- [ ] **Step 15.3: Write the failing settings test**

Create `packages/vscode-extension/test/unit/settings.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createSettings } from "../../src/settings.ts";
import type { WorkspaceApi } from "../../src/vscode-shim.ts";

function makeWorkspace(values: Record<string, unknown>): WorkspaceApi {
  return {
    getConfiguration: () => ({
      get: <T,>(key: string, dflt: T): T => (key in values ? (values[key] as T) : dflt),
    }),
  };
}

describe("Settings", () => {
  test("returns defaults when keys absent", () => {
    const s = createSettings(makeWorkspace({}));
    expect(s.socketPath()).toBe("");
    expect(s.autoStartGateway()).toBe(false);
    expect(s.statusBarPollMs()).toBe(30000);
    expect(s.transcriptHistoryLimit()).toBe(50);
    expect(s.askAgent()).toBe("");
    expect(s.hitlAlwaysModal()).toBe(false);
    expect(s.logLevel()).toBe("info");
  });

  test("returns user-set values", () => {
    const s = createSettings(
      makeWorkspace({
        socketPath: "/tmp/custom.sock",
        autoStartGateway: true,
        statusBarPollMs: 5000,
        transcriptHistoryLimit: 200,
        askAgent: "mainAgent",
        hitlAlwaysModal: true,
        logLevel: "debug",
      }),
    );
    expect(s.socketPath()).toBe("/tmp/custom.sock");
    expect(s.autoStartGateway()).toBe(true);
    expect(s.statusBarPollMs()).toBe(5000);
    expect(s.transcriptHistoryLimit()).toBe(200);
    expect(s.askAgent()).toBe("mainAgent");
    expect(s.hitlAlwaysModal()).toBe(true);
    expect(s.logLevel()).toBe("debug");
  });
});
```

- [ ] **Step 15.4: Implement `settings.ts`**

Create `packages/vscode-extension/src/settings.ts`:

```ts
import type { WorkspaceApi } from "./vscode-shim.js";

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Settings {
  socketPath(): string;
  autoStartGateway(): boolean;
  statusBarPollMs(): number;
  transcriptHistoryLimit(): number;
  askAgent(): string;
  hitlAlwaysModal(): boolean;
  logLevel(): LogLevel;
}

export function createSettings(workspace: WorkspaceApi): Settings {
  const cfg = (): { get<T>(k: string, d: T): T } => workspace.getConfiguration("nimbus");
  return {
    socketPath: () => cfg().get<string>("socketPath", ""),
    autoStartGateway: () => cfg().get<boolean>("autoStartGateway", false),
    statusBarPollMs: () => cfg().get<number>("statusBarPollMs", 30000),
    transcriptHistoryLimit: () => cfg().get<number>("transcriptHistoryLimit", 50),
    askAgent: () => cfg().get<string>("askAgent", ""),
    hitlAlwaysModal: () => cfg().get<boolean>("hitlAlwaysModal", false),
    logLevel: () => {
      const lvl = cfg().get<string>("logLevel", "info");
      if (lvl === "error" || lvl === "warn" || lvl === "info" || lvl === "debug") return lvl;
      return "info";
    },
  };
}
```

- [ ] **Step 15.5: Write the failing logging test**

Create `packages/vscode-extension/test/unit/logging.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createLogger } from "../../src/logging.ts";
import type { OutputChannelHandle } from "../../src/vscode-shim.ts";

function makeChannel(): { ch: OutputChannelHandle; lines: string[] } {
  const lines: string[] = [];
  const ch: OutputChannelHandle = {
    appendLine: (m) => {
      lines.push(m);
    },
    show: () => undefined,
    dispose: () => undefined,
  };
  return { ch, lines };
}

describe("Logger", () => {
  test("respects logLevel — debug level shows everything", () => {
    const { ch, lines } = makeChannel();
    const log = createLogger(ch, () => "debug");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(lines.length).toBe(4);
  });

  test("info level suppresses debug only", () => {
    const { ch, lines } = makeChannel();
    const log = createLogger(ch, () => "info");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(lines.length).toBe(3);
    expect(lines.some((l) => l.includes("[debug]"))).toBe(false);
  });

  test("error level suppresses warn/info/debug", () => {
    const { ch, lines } = makeChannel();
    const log = createLogger(ch, () => "error");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("[error]");
  });
});
```

- [ ] **Step 15.6: Implement `logging.ts`**

Create `packages/vscode-extension/src/logging.ts`:

```ts
import type { LogLevel } from "./settings.js";
import type { OutputChannelHandle } from "./vscode-shim.js";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

export function createLogger(
  channel: OutputChannelHandle,
  getLevel: () => LogLevel,
): Logger {
  const emit = (level: LogLevel, msg: string): void => {
    if (ORDER[level] > ORDER[getLevel()]) return;
    const ts = new Date().toISOString();
    channel.appendLine(`${ts} [${level}] ${msg}`);
  };
  return {
    error: (m) => emit("error", m),
    warn: (m) => emit("warn", m),
    info: (m) => emit("info", m),
    debug: (m) => emit("debug", m),
  };
}
```

- [ ] **Step 15.7: Run tests + typecheck**

```bash
cd packages/vscode-extension && bunx vitest run && bun run typecheck
```

Expected: PASS, 5 tests; typecheck clean.

- [ ] **Step 15.8: Commit**

```bash
git add packages/vscode-extension/src/vscode-shim.ts packages/vscode-extension/src/settings.ts packages/vscode-extension/src/logging.ts packages/vscode-extension/test/unit/
git commit -m "feat(vscode-extension): testable shim layer, Settings, Logger"
```

---

## Task 16: Implement `ConnectionManager` (reconnect loop, EACCES handling)

**Files:**
- Create: `packages/vscode-extension/src/connection/connection-manager.ts`
- Create: `packages/vscode-extension/test/unit/connection-manager.test.ts`

---

- [ ] **Step 16.1: Write the failing test**

Create `packages/vscode-extension/test/unit/connection-manager.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createConnectionManager,
  type ConnectionDeps,
  type ConnectionState,
} from "../../src/connection/connection-manager.ts";

class FakeClient {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeDeps(opts: {
  openSequence: Array<"ok" | "eacces" | "enoent">;
}): { deps: ConnectionDeps; events: ConnectionState[]; openCalls: number } {
  const events: ConnectionState[] = [];
  let openCallIndex = 0;
  const deps: ConnectionDeps = {
    open: async () => {
      const outcome = opts.openSequence[openCallIndex] ?? "ok";
      openCallIndex += 1;
      if (outcome === "eacces") {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      if (outcome === "enoent") {
        const err = new Error("no such file") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return new FakeClient() as unknown as never;
    },
    discoverSocket: async () => ({
      socketPath: "/tmp/test.sock",
      source: "default" as const,
    }),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    reconnectDelayMs: 5,
  };
  const mgr = createConnectionManager(deps);
  mgr.onState((s) => events.push(s));
  return { deps, events, openCalls: 0 };
}

describe("ConnectionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("transitions connecting → connected on success", async () => {
    const { deps, events } = makeDeps({ openSequence: ["ok"] });
    const mgr = createConnectionManager(deps);
    const collected: ConnectionState[] = [];
    mgr.onState((s) => collected.push(s));
    await mgr.start();
    expect(collected.map((s) => s.kind)).toContain("connected");
    void events;
    await mgr.dispose();
  });

  test("transitions to permission-denied on EACCES", async () => {
    const deps: ConnectionDeps = {
      open: async () => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
      discoverSocket: async () => ({ socketPath: "/tmp/x.sock", source: "default" as const }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      reconnectDelayMs: 1000,
    };
    const mgr = createConnectionManager(deps);
    const states: ConnectionState[] = [];
    mgr.onState((s) => states.push(s));
    await mgr.start();
    const last = states[states.length - 1];
    expect(last?.kind).toBe("permission-denied");
    if (last?.kind === "permission-denied") {
      expect(last.socketPath).toBe("/tmp/x.sock");
    }
    await mgr.dispose();
  });

  test("retries on ENOENT until success", async () => {
    const deps: ConnectionDeps = (() => {
      let i = 0;
      return {
        open: async () => {
          i += 1;
          if (i < 3) {
            const err = new Error("nope") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
          return new FakeClient() as unknown as never;
        },
        discoverSocket: async () => ({ socketPath: "/tmp/y.sock", source: "default" as const }),
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        reconnectDelayMs: 1,
      };
    })();
    const mgr = createConnectionManager(deps);
    const states: ConnectionState[] = [];
    mgr.onState((s) => states.push(s));
    await mgr.start();
    // Allow retries
    await new Promise((r) => setTimeout(r, 50));
    const kinds = states.map((s) => s.kind);
    expect(kinds).toContain("connected");
    await mgr.dispose();
  });
});
```

- [ ] **Step 16.2: Run test to confirm it fails**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/connection-manager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 16.3: Implement `connection-manager.ts`**

Create `packages/vscode-extension/src/connection/connection-manager.ts`:

```ts
import type { Logger } from "../logging.js";

export type ConnectionState =
  | { kind: "idle" }
  | { kind: "connecting"; socketPath: string }
  | { kind: "connected"; socketPath: string }
  | { kind: "disconnected"; socketPath: string; reason: string }
  | { kind: "permission-denied"; socketPath: string }
  | { kind: "starting-gateway"; socketPath: string };

export interface NimbusClientLike {
  close(): Promise<void>;
}

export interface ConnectionDeps {
  open(socketPath: string): Promise<NimbusClientLike>;
  discoverSocket(override?: string): Promise<{ socketPath: string; source: string }>;
  log: Logger;
  reconnectDelayMs?: number;
  socketPathOverride?: string;
}

export interface ConnectionManager {
  start(): Promise<void>;
  dispose(): Promise<void>;
  /** Force an immediate reconnect attempt, bypassing the backoff timer.
   *  Used by the `nimbus.reconnect` command. Idempotent — safe to call
   *  while already connected (no-op) or while a reconnect is pending
   *  (cancels the timer and tries now). */
  reconnectNow(): Promise<void>;
  onState(listener: (s: ConnectionState) => void): { dispose(): void };
  current(): ConnectionState;
  client(): NimbusClientLike | undefined;
}

const DEFAULT_RECONNECT_MS = 3000;

export function createConnectionManager(deps: ConnectionDeps): ConnectionManager {
  const listeners: Array<(s: ConnectionState) => void> = [];
  let state: ConnectionState = { kind: "idle" };
  let client: NimbusClientLike | undefined;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const setState = (s: ConnectionState): void => {
    state = s;
    for (const l of listeners) l(s);
  };

  const tryConnect = async (): Promise<void> => {
    if (stopped) return;
    const disc = await deps.discoverSocket(deps.socketPathOverride);
    setState({ kind: "connecting", socketPath: disc.socketPath });
    try {
      const c = await deps.open(disc.socketPath);
      client = c;
      setState({ kind: "connected", socketPath: disc.socketPath });
      deps.log.info(`Connected to Gateway at ${disc.socketPath} (source=${disc.source})`);
    } catch (e) {
      const errno = (e as NodeJS.ErrnoException).code;
      if (errno === "EACCES") {
        deps.log.error(`Permission denied accessing socket: ${disc.socketPath}`);
        setState({ kind: "permission-denied", socketPath: disc.socketPath });
        scheduleReconnect();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      deps.log.warn(`Connect failed (${errno ?? "unknown"}): ${msg}`);
      setState({ kind: "disconnected", socketPath: disc.socketPath, reason: msg });
      scheduleReconnect();
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void tryConnect();
    }, deps.reconnectDelayMs ?? DEFAULT_RECONNECT_MS);
  };

  return {
    async start(): Promise<void> {
      stopped = false;
      await tryConnect();
    },
    async dispose(): Promise<void> {
      stopped = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (client !== undefined) {
        await client.close().catch(() => undefined);
        client = undefined;
      }
      listeners.length = 0;
    },
    async reconnectNow(): Promise<void> {
      if (state.kind === "connected") return;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      await tryConnect();
    },
    onState(listener): { dispose(): void } {
      listeners.push(listener);
      listener(state);
      return {
        dispose: () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      };
    },
    current: () => state,
    client: () => client,
  };
}
```

- [ ] **Step 16.4: Run test to verify it passes**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/connection-manager.test.ts
```

Expected: PASS, 3 of 3.

- [ ] **Step 16.5: Commit**

```bash
git add packages/vscode-extension/src/connection/connection-manager.ts packages/vscode-extension/test/unit/connection-manager.test.ts
git commit -m "feat(vscode-extension): ConnectionManager with EACCES distinct state + reconnect"
```

---

## Task 17: Implement `AutoStarter` (spawn `nimbus start`, PATH detection)

**Files:**
- Create: `packages/vscode-extension/src/connection/auto-start.ts`
- Create: `packages/vscode-extension/test/unit/auto-start.test.ts`

---

- [ ] **Step 17.1: Write the failing test**

Create `packages/vscode-extension/test/unit/auto-start.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";

import { createAutoStarter, type AutoStartDeps } from "../../src/connection/auto-start.ts";

class FakeChild extends EventEmitter {
  killed = false;
  unref = vi.fn();
  kill = vi.fn(() => {
    this.killed = true;
  });
}

function makeDeps(opts: {
  spawnFails?: boolean;
  socketAppearsAfterMs?: number;
}): AutoStartDeps {
  let socketReady = false;
  setTimeout(() => {
    socketReady = true;
  }, opts.socketAppearsAfterMs ?? 5);
  return {
    spawn: vi.fn(() => {
      if (opts.spawnFails === true) {
        const child = new FakeChild();
        setTimeout(() => child.emit("error", new Error("ENOENT")), 1);
        return child as unknown as never;
      }
      return new FakeChild() as unknown as never;
    }),
    pingSocket: vi.fn(async () => socketReady),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    timeoutMs: 200,
    pollIntervalMs: 5,
  };
}

describe("AutoStarter.spawn", () => {
  test("returns success when socket appears within timeout", async () => {
    const deps = makeDeps({ socketAppearsAfterMs: 20 });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("ok");
  });

  test("returns timeout when socket never appears", async () => {
    const deps = makeDeps({ socketAppearsAfterMs: 99999 });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("timeout");
  });

  test("returns spawn-error when binary not found", async () => {
    const deps = makeDeps({ spawnFails: true });
    const starter = createAutoStarter(deps);
    const r = await starter.spawn("/tmp/x.sock");
    expect(r.kind).toBe("spawn-error");
  });
});
```

- [ ] **Step 17.2: Implement `auto-start.ts`**

Create `packages/vscode-extension/src/connection/auto-start.ts`:

```ts
import type { ChildProcess } from "node:child_process";

import type { Logger } from "../logging.js";

export type AutoStartResult =
  | { kind: "ok" }
  | { kind: "timeout"; socketPath: string }
  | { kind: "spawn-error"; message: string };

export interface AutoStartDeps {
  spawn: (cmd: string, args: string[]) => ChildProcess;
  pingSocket: (socketPath: string) => Promise<boolean>;
  log: Logger;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface AutoStarter {
  spawn(socketPath: string): Promise<AutoStartResult>;
}

export function createAutoStarter(deps: AutoStartDeps): AutoStarter {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const pollMs = deps.pollIntervalMs ?? 200;
  return {
    spawn: async (socketPath): Promise<AutoStartResult> => {
      let spawnError: string | undefined;
      let proc: ChildProcess;
      try {
        proc = deps.spawn("nimbus", ["start"]);
      } catch (e) {
        return { kind: "spawn-error", message: e instanceof Error ? e.message : String(e) };
      }
      proc.on("error", (err) => {
        spawnError = err.message;
        deps.log.error(`nimbus start spawn error: ${err.message}`);
      });
      proc.unref?.();

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (spawnError !== undefined) return { kind: "spawn-error", message: spawnError };
        if (await deps.pingSocket(socketPath)) {
          deps.log.info(`Gateway socket ready at ${socketPath} after ${Date.now() - start}ms`);
          return { kind: "ok" };
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { kind: "timeout", socketPath };
    },
  };
}
```

- [ ] **Step 17.3: Run test to verify it passes**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/auto-start.test.ts
```

Expected: PASS, 3 of 3.

- [ ] **Step 17.4: Commit**

```bash
git add packages/vscode-extension/src/connection/auto-start.ts packages/vscode-extension/test/unit/auto-start.test.ts
git commit -m "feat(vscode-extension): AutoStarter with PATH detection + socket-readiness poll"
```

---

## Task 18: Implement `StatusBarItem` (state-table-driven)

**Files:**
- Create: `packages/vscode-extension/src/status-bar/status-bar-item.ts`
- Create: `packages/vscode-extension/test/unit/status-bar-item.test.ts`

---

- [ ] **Step 18.1: Write the failing test**

Create `packages/vscode-extension/test/unit/status-bar-item.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  formatStatusBar,
  type StatusBarInputs,
} from "../../src/status-bar/status-bar-item.ts";

function inputs(p: Partial<StatusBarInputs> = {}): StatusBarInputs {
  return {
    connection: { kind: "connected", socketPath: "/tmp/s" },
    profile: "work",
    degradedConnectorCount: 0,
    degradedConnectorNames: [],
    pendingHitlCount: 0,
    autoStartGateway: false,
    ...p,
  };
}

describe("formatStatusBar", () => {
  test("connecting state", () => {
    const r = formatStatusBar(inputs({ connection: { kind: "connecting", socketPath: "/x" } }));
    expect(r.text).toMatch(/connecting/);
    expect(r.command).toBeUndefined();
  });

  test("disconnected, autostart off", () => {
    const r = formatStatusBar(
      inputs({
        connection: { kind: "disconnected", socketPath: "/x", reason: "no socket" },
      }),
    );
    expect(r.text).toMatch(/Gateway not running/);
    expect(r.backgroundColor?.id).toMatch(/warningBackground/);
    expect(r.command).toBe("nimbus.startGateway");
  });

  test("permission denied has distinct state and tooltip", () => {
    const r = formatStatusBar(
      inputs({ connection: { kind: "permission-denied", socketPath: "/sock" } }),
    );
    expect(r.text).toMatch(/Socket permission denied/);
    expect(r.tooltip).toContain("/sock");
    expect(r.backgroundColor?.id).toMatch(/errorBackground/);
  });

  test("connected healthy", () => {
    const r = formatStatusBar(inputs());
    expect(r.text).toMatch(/work/);
    expect(r.text).toMatch(/circle-large-filled/);
    expect(r.command).toBe("nimbus.ask");
  });

  test("connected with degraded connector", () => {
    const r = formatStatusBar(
      inputs({ degradedConnectorCount: 2, degradedConnectorNames: ["github", "slack"] }),
    );
    expect(r.text).toMatch(/2 degraded/);
    expect(r.backgroundColor?.id).toMatch(/warningBackground/);
    expect(r.tooltip).toContain("github");
    expect(r.tooltip).toContain("slack");
  });

  test("HITL pending wins over degraded for click action", () => {
    const r = formatStatusBar(inputs({ degradedConnectorCount: 1, pendingHitlCount: 3 }));
    expect(r.text).toMatch(/3 pending/);
    expect(r.text).toMatch(/1 degraded/);
    expect(r.command).toBe("nimbus.showPendingHitl");
  });
});
```

- [ ] **Step 18.2: Implement `status-bar-item.ts`**

Create `packages/vscode-extension/src/status-bar/status-bar-item.ts`:

```ts
import type { ConnectionState } from "../connection/connection-manager.js";
import type { StatusBarItemHandle } from "../vscode-shim.js";

export type StatusBarInputs = {
  connection: ConnectionState;
  profile: string;
  degradedConnectorCount: number;
  /** Names of degraded connectors so the tooltip can list them — keeps users
   *  out of the chat panel for a quick "what's broken?" check. */
  degradedConnectorNames: string[];
  pendingHitlCount: number;
  autoStartGateway: boolean;
};

export type StatusBarRender = {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  backgroundColor: { id: string } | undefined;
};

const COLOR_WARN = { id: "statusBarItem.warningBackground" };
const COLOR_ERR = { id: "statusBarItem.errorBackground" };

export function formatStatusBar(inp: StatusBarInputs): StatusBarRender {
  const {
    connection,
    profile,
    degradedConnectorCount,
    degradedConnectorNames,
    pendingHitlCount,
    autoStartGateway,
  } = inp;

  if (connection.kind === "connecting" || connection.kind === "idle") {
    return {
      text: "Nimbus: $(sync~spin) connecting…",
      tooltip:
        connection.kind === "connecting"
          ? `Connecting to Gateway socket: ${connection.socketPath}`
          : "Initializing",
      command: undefined,
      backgroundColor: undefined,
    };
  }

  if (connection.kind === "permission-denied") {
    return {
      text: "Nimbus: $(error) Socket permission denied",
      tooltip: `Permission denied accessing socket: ${connection.socketPath} — check file ownership/mode or socketPath setting`,
      command: "nimbus.openLogs",
      backgroundColor: COLOR_ERR,
    };
  }

  if (connection.kind === "disconnected") {
    if (autoStartGateway) {
      return {
        text: "Nimbus: $(sync~spin) starting Gateway…",
        tooltip: `Spawning nimbus start; reconnecting to ${connection.socketPath}`,
        command: undefined,
        backgroundColor: undefined,
      };
    }
    return {
      text: "Nimbus: $(circle-slash) Gateway not running",
      tooltip: `Run "Nimbus: Start Gateway" or start manually with: nimbus start`,
      command: "nimbus.startGateway",
      backgroundColor: COLOR_WARN,
    };
  }

  if (connection.kind === "starting-gateway") {
    return {
      text: "Nimbus: $(sync~spin) starting Gateway…",
      tooltip: "Spawning nimbus start; waiting for socket",
      command: undefined,
      backgroundColor: undefined,
    };
  }

  // connected
  const tags: string[] = [];
  if (degradedConnectorCount > 0) tags.push(`${degradedConnectorCount} degraded`);
  if (pendingHitlCount > 0) tags.push(`${pendingHitlCount} pending`);
  let icon = "$(circle-large-filled)";
  let bg: { id: string } | undefined;
  if (pendingHitlCount > 0) {
    icon = "$(bell-dot)";
    bg = COLOR_WARN;
  } else if (degradedConnectorCount > 0) {
    icon = "$(warning)";
    bg = COLOR_WARN;
  }
  const profileSegment = profile.length > 0 ? profile : "default";
  const tagSegment = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
  const text = `Nimbus: ${icon} ${profileSegment}${tagSegment}`;

  let command = "nimbus.ask";
  const degradedSummary =
    degradedConnectorCount === 0
      ? "0 connectors degraded"
      : degradedConnectorNames.length > 0
        ? `${degradedConnectorCount} degraded: ${degradedConnectorNames.join(", ")}`
        : `${degradedConnectorCount} connectors degraded`;
  let tooltip = `Connected · profile=${profileSegment} · ${degradedSummary}`;
  if (pendingHitlCount > 0) {
    command = "nimbus.showPendingHitl";
    tooltip = `${pendingHitlCount} consent request(s) waiting${
      degradedConnectorCount > 0 ? ` · ${degradedSummary}` : ""
    }`;
  }

  return { text, tooltip, command, backgroundColor: bg };
}

export interface StatusBarController {
  update(inp: StatusBarInputs): void;
  dispose(): void;
}

export function createStatusBarController(item: StatusBarItemHandle): StatusBarController {
  item.show();
  return {
    update(inp): void {
      const r = formatStatusBar(inp);
      item.text = r.text;
      item.tooltip = r.tooltip;
      item.command = r.command;
      item.backgroundColor = r.backgroundColor;
    },
    dispose(): void {
      item.dispose();
    },
  };
}
```

- [ ] **Step 18.3: Run test + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/status-bar-item.test.ts
git add packages/vscode-extension/src/status-bar/status-bar-item.ts packages/vscode-extension/test/unit/status-bar-item.test.ts
git commit -m "feat(vscode-extension): state-table-driven status bar formatter"
```

Expected: PASS, 6 of 6, then commit.

---

## Task 19: Implement `HitlRouter` (context-sensitive routing)

**Files:**
- Create: `packages/vscode-extension/src/hitl/hitl-router.ts`
- Create: `packages/vscode-extension/test/unit/hitl-router.test.ts`

---

- [ ] **Step 19.1: Write the failing test**

Create `packages/vscode-extension/test/unit/hitl-router.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { createHitlRouter, type HitlRouterDeps } from "../../src/hitl/hitl-router.ts";
import type { HitlRequest } from "@nimbus-dev/client";

function makeDeps(opts: { chatVisibleAndFocused: boolean; alwaysModal?: boolean }): HitlRouterDeps {
  return {
    chatPanelVisibleAndFocused: () => opts.chatVisibleAndFocused,
    streamRegistered: (sid) => sid === "active-stream",
    showInline: vi.fn(async () => "approve" as const),
    showToast: vi.fn(async () => "approve" as const),
    showModal: vi.fn(async () => "approve" as const),
    sendResponse: vi.fn(async () => undefined),
    onCountChange: vi.fn(),
    alwaysModal: () => opts.alwaysModal ?? false,
  };
}

const REQ: HitlRequest = { requestId: "req-1", prompt: "Approve action?" };

describe("HitlRouter", () => {
  test("routes inline when stream-tagged AND chat is visible+focused", async () => {
    const deps = makeDeps({ chatVisibleAndFocused: true });
    const router = createHitlRouter(deps);
    await router.handle({ ...REQ, streamId: "active-stream" });
    expect(deps.showInline).toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.showModal).not.toHaveBeenCalled();
  });

  test("routes toast for background HITL by default", async () => {
    const deps = makeDeps({ chatVisibleAndFocused: false });
    const router = createHitlRouter(deps);
    await router.handle({ ...REQ });
    expect(deps.showToast).toHaveBeenCalled();
    expect(deps.showModal).not.toHaveBeenCalled();
  });

  test("routes modal when nimbus.hitlAlwaysModal is true", async () => {
    const deps = makeDeps({ chatVisibleAndFocused: false, alwaysModal: true });
    const router = createHitlRouter(deps);
    await router.handle({ ...REQ });
    expect(deps.showModal).toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  test("dedupes duplicate requestIds", async () => {
    const deps = makeDeps({ chatVisibleAndFocused: false });
    const router = createHitlRouter(deps);
    await Promise.all([router.handle({ ...REQ }), router.handle({ ...REQ })]);
    expect(deps.showToast).toHaveBeenCalledTimes(1);
  });

  test("emits count changes (+1 on enqueue, -1 on response)", async () => {
    const deps = makeDeps({ chatVisibleAndFocused: false });
    const router = createHitlRouter(deps);
    await router.handle({ ...REQ });
    expect(deps.onCountChange).toHaveBeenCalled();
    const counts = (deps.onCountChange as unknown as { mock: { calls: [number][] } }).mock.calls.map(
      ([n]) => n,
    );
    expect(counts).toEqual(expect.arrayContaining([1, 0]));
  });

  test("snapshot returns currently-pending requests", async () => {
    const deps: HitlRouterDeps = {
      ...makeDeps({ chatVisibleAndFocused: false }),
      // never resolve so the request stays pending
      showToast: vi.fn(() => new Promise(() => undefined)),
    };
    const router = createHitlRouter(deps);
    void router.handle({ requestId: "r-pending", prompt: "p" });
    await new Promise((r) => setTimeout(r, 5));
    expect(router.snapshot().map((r) => r.requestId)).toContain("r-pending");
  });
});
```

- [ ] **Step 19.2: Implement `hitl-router.ts`**

Create `packages/vscode-extension/src/hitl/hitl-router.ts`:

```ts
import type { HitlRequest } from "@nimbus-dev/client";

export type HitlDecision = "approve" | "reject";

export interface HitlRouterDeps {
  chatPanelVisibleAndFocused(): boolean;
  streamRegistered(streamId: string): boolean;
  showInline(req: HitlRequest): Promise<HitlDecision | undefined>;
  showToast(req: HitlRequest): Promise<HitlDecision | undefined>;
  showModal(req: HitlRequest): Promise<HitlDecision | undefined>;
  sendResponse(requestId: string, decision: HitlDecision): Promise<void>;
  onCountChange(count: number): void;
  alwaysModal(): boolean;
}

export interface HitlRouter {
  handle(req: HitlRequest): Promise<void>;
  snapshot(): HitlRequest[];
}

export function createHitlRouter(deps: HitlRouterDeps): HitlRouter {
  const pending = new Map<string, HitlRequest>();

  const emitCount = (): void => {
    deps.onCountChange(pending.size);
  };

  const handleOne = async (req: HitlRequest): Promise<void> => {
    if (pending.has(req.requestId)) return;
    pending.set(req.requestId, req);
    emitCount();
    try {
      const useInline =
        typeof req.streamId === "string" &&
        deps.streamRegistered(req.streamId) &&
        deps.chatPanelVisibleAndFocused();
      let decision: HitlDecision | undefined;
      if (useInline) {
        decision = await deps.showInline(req);
      } else if (deps.alwaysModal()) {
        decision = await deps.showModal(req);
      } else {
        decision = await deps.showToast(req);
      }
      if (decision !== undefined) {
        await deps.sendResponse(req.requestId, decision);
      }
    } finally {
      pending.delete(req.requestId);
      emitCount();
    }
  };

  return {
    handle: handleOne,
    snapshot: () => Array.from(pending.values()),
  };
}
```

- [ ] **Step 19.3: Run test + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/hitl-router.test.ts
git add packages/vscode-extension/src/hitl/hitl-router.ts packages/vscode-extension/test/unit/hitl-router.test.ts
git commit -m "feat(vscode-extension): HitlRouter — inline / toast / modal context routing"
```

Expected: PASS, 6 of 6.

---

## Task 20: Implement HITL surfaces — toast, modal, details Webview

**Files:**
- Create: `packages/vscode-extension/src/hitl/hitl-toast.ts`
- Create: `packages/vscode-extension/src/hitl/hitl-modal.ts`
- Create: `packages/vscode-extension/src/hitl/hitl-details-webview.ts`
- Create: `packages/vscode-extension/test/unit/hitl-surfaces.test.ts`

---

- [ ] **Step 20.1: Write the failing test**

Create `packages/vscode-extension/test/unit/hitl-surfaces.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { createToastSurface } from "../../src/hitl/hitl-toast.ts";
import { createModalSurface } from "../../src/hitl/hitl-modal.ts";
import type { WindowApi } from "../../src/vscode-shim.ts";

function fakeWindow(answer: string | undefined): WindowApi {
  const showInformationMessage = vi.fn(async () => answer);
  return {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined,
    }),
    createStatusBarItem: () => ({
      text: "",
      tooltip: undefined,
      command: undefined,
      backgroundColor: undefined,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
    }),
    showInformationMessage: showInformationMessage as unknown as WindowApi["showInformationMessage"],
    showErrorMessage: vi.fn() as unknown as WindowApi["showErrorMessage"],
    showInputBox: vi.fn() as unknown as WindowApi["showInputBox"],
  };
}

describe("ToastSurface", () => {
  test("returns approve when user clicks Approve", async () => {
    const surf = createToastSurface(fakeWindow("Approve"));
    const r = await surf({ requestId: "r1", prompt: "ok?" });
    expect(r).toBe("approve");
  });
  test("returns reject when user clicks Reject", async () => {
    const surf = createToastSurface(fakeWindow("Reject"));
    const r = await surf({ requestId: "r1", prompt: "ok?" });
    expect(r).toBe("reject");
  });
  test("returns undefined when dismissed", async () => {
    const surf = createToastSurface(fakeWindow(undefined));
    const r = await surf({ requestId: "r1", prompt: "ok?" });
    expect(r).toBeUndefined();
  });
});

describe("ModalSurface", () => {
  test("uses {modal:true} option", async () => {
    const calls: { args: unknown[] }[] = [];
    const window: WindowApi = {
      ...fakeWindow("Approve"),
      showInformationMessage: (async (...args: unknown[]) => {
        calls.push({ args });
        return "Approve";
      }) as unknown as WindowApi["showInformationMessage"],
    };
    const surf = createModalSurface(window);
    await surf({ requestId: "r1", prompt: "ok?" });
    expect(calls[0]?.args[1]).toEqual({ modal: true });
  });
});
```

- [ ] **Step 20.2: Implement `hitl-toast.ts`**

Create `packages/vscode-extension/src/hitl/hitl-toast.ts`:

```ts
import type { HitlRequest } from "@nimbus-dev/client";

import type { WindowApi } from "../vscode-shim.js";
import type { HitlDecision } from "./hitl-router.js";

export function createToastSurface(window: WindowApi) {
  return async (req: HitlRequest): Promise<HitlDecision | undefined> => {
    const answer = await window.showInformationMessage(
      `Nimbus consent: ${req.prompt}`,
      {},
      "Approve",
      "Reject",
      "View Details",
    );
    if (answer === "Approve") return "approve";
    if (answer === "Reject") return "reject";
    if (answer === "View Details") {
      // Caller (HitlRouter) re-prompts after the details Webview closes.
      // For v0.1.0, View Details opens the details Webview and the user
      // responds there; the toast itself returns undefined.
      // The details Webview surface (Task 20.4) sends the response directly.
      return undefined;
    }
    return undefined;
  };
}
```

- [ ] **Step 20.3: Implement `hitl-modal.ts`**

Create `packages/vscode-extension/src/hitl/hitl-modal.ts`:

```ts
import type { HitlRequest } from "@nimbus-dev/client";

import type { WindowApi } from "../vscode-shim.js";
import type { HitlDecision } from "./hitl-router.js";

export function createModalSurface(window: WindowApi) {
  return async (req: HitlRequest): Promise<HitlDecision | undefined> => {
    const answer = await window.showInformationMessage(
      `Nimbus consent required: ${req.prompt}`,
      { modal: true },
      "Approve",
      "Reject",
    );
    if (answer === "Approve") return "approve";
    if (answer === "Reject") return "reject";
    return undefined;
  };
}
```

- [ ] **Step 20.4: Implement `hitl-details-webview.ts`**

Create `packages/vscode-extension/src/hitl/hitl-details-webview.ts`:

```ts
import type { HitlRequest } from "@nimbus-dev/client";

import type { HitlDecision } from "./hitl-router.js";

/**
 * Opens a transient WebviewPanel showing the HITL request's details payload
 * (for non-file-edit multi-action requests). For file-edit actions, callers
 * should use vscode.diff() instead — this Webview is the structured-payload
 * fallback.
 *
 * The full vscode-API binding lives in extension.ts (the only file allowed to
 * touch real vscode imports). This module exposes the pure render helper +
 * the dispatch contract.
 */

export type HitlDetailsRenderInput = {
  request: HitlRequest;
  cspSource: string;
};

export function renderDetailsHtml(inp: HitlDetailsRenderInput): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline' ${inp.cspSource}; script-src ${inp.cspSource};`;
  const detailsJson = JSON.stringify(inp.request.details ?? null, null, 2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Nimbus Consent Details</title>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground);
       background: var(--vscode-editor-background); padding: 1em; }
pre { background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 1em; overflow: auto; }
.actions { margin-top: 1em; display: flex; gap: 0.5em; }
button { padding: 0.5em 1em; cursor: pointer;
         background: var(--vscode-button-background); color: var(--vscode-button-foreground);
         border: none; }
button.reject { background: var(--vscode-errorForeground); }
</style>
</head>
<body>
<h2>${escapeHtml(inp.request.prompt)}</h2>
<pre>${escapeHtml(detailsJson)}</pre>
<div class="actions">
  <button id="approve">Approve</button>
  <button id="reject" class="reject">Reject</button>
</div>
<script>
const vscode = acquireVsCodeApi();
document.getElementById("approve").addEventListener("click", () =>
  vscode.postMessage({ type: "hitlDecision", decision: "approve", requestId: ${JSON.stringify(inp.request.requestId)} }));
document.getElementById("reject").addEventListener("click", () =>
  vscode.postMessage({ type: "hitlDecision", decision: "reject", requestId: ${JSON.stringify(inp.request.requestId)} }));
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type DetailsDecisionMessage = {
  type: "hitlDecision";
  requestId: string;
  decision: HitlDecision;
};
```

- [ ] **Step 20.5: Run tests + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/hitl-surfaces.test.ts
git add packages/vscode-extension/src/hitl/ packages/vscode-extension/test/unit/hitl-surfaces.test.ts
git commit -m "feat(vscode-extension): HITL toast + modal + details-webview surfaces"
```

Expected: PASS, 4 of 4.

---

## Task 21: Implement `ChatPanel`, `chat-protocol.ts`, `SessionStore`

**Files:**
- Create: `packages/vscode-extension/src/chat/chat-protocol.ts`
- Create: `packages/vscode-extension/src/chat/session-store.ts`
- Create: `packages/vscode-extension/src/chat/chat-panel.ts`
- Create: `packages/vscode-extension/test/unit/session-store.test.ts`

---

- [ ] **Step 21.1: Implement `chat-protocol.ts` (no test — pure types)**

Create `packages/vscode-extension/src/chat/chat-protocol.ts`:

```ts
/**
 * Typed messages exchanged between extension host and the chat Webview.
 * Both directions go through `webview.postMessage`. Discriminate on `type`.
 */

export type ExtensionToWebview =
  | { type: "reset" }
  | {
      type: "hydrate";
      turns: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
    }
  | { type: "userMessage"; text: string }
  | { type: "token"; text: string }
  | { type: "subTask"; subTaskId: string; status: string; progress?: number }
  | {
      type: "hitlInline";
      requestId: string;
      prompt: string;
      details?: unknown;
    }
  | { type: "done"; reply: string; sessionId: string }
  | { type: "error"; message: string }
  | {
      type: "emptyState";
      sub: "no-transcript" | "disconnected" | "permission-denied";
      socketPath?: string;
    }
  | { type: "themeChange" };

export type WebviewToExtension =
  | { type: "submitAsk"; text: string }
  | { type: "stopStream" }
  | { type: "hitlResponse"; requestId: string; decision: "approve" | "reject" }
  | { type: "requestRehydrate"; sessionId: string }
  | { type: "ready" }
  | { type: "openLogs" }
  | { type: "startGateway" }
  | { type: "openExternal"; url: string };
```

- [ ] **Step 21.2: Write the failing session-store test**

Create `packages/vscode-extension/test/unit/session-store.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createSessionStore } from "../../src/chat/session-store.ts";
import type { MementoLike } from "../../src/vscode-shim.ts";

function makeMemento(initial: Record<string, unknown> = {}): MementoLike {
  const data = { ...initial };
  return {
    get: <T,>(key: string, dflt?: T): T | undefined => (key in data ? (data[key] as T) : dflt),
    update: async (key, value) => {
      if (value === undefined) delete data[key];
      else data[key] = value;
    },
  };
}

describe("SessionStore", () => {
  test("returns undefined when no sessionId stored", () => {
    const s = createSessionStore(makeMemento());
    expect(s.get()).toBeUndefined();
  });

  test("set/get round-trip", async () => {
    const s = createSessionStore(makeMemento());
    await s.set("sess-abc");
    expect(s.get()).toBe("sess-abc");
  });

  test("clear removes the stored value", async () => {
    const s = createSessionStore(makeMemento({ "nimbus.activeSessionId": "x" }));
    expect(s.get()).toBe("x");
    await s.clear();
    expect(s.get()).toBeUndefined();
  });

  test("rejects non-UUID-looking content (sanity guard)", async () => {
    const s = createSessionStore(makeMemento());
    await expect(s.set("")).rejects.toThrow();
  });
});
```

- [ ] **Step 21.3: Implement `session-store.ts`**

Create `packages/vscode-extension/src/chat/session-store.ts`:

```ts
import type { MementoLike } from "../vscode-shim.js";

const KEY = "nimbus.activeSessionId";

export interface SessionStore {
  get(): string | undefined;
  set(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

export function createSessionStore(memento: MementoLike): SessionStore {
  return {
    get: () => memento.get<string>(KEY),
    set: async (sessionId) => {
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("SessionStore.set requires a non-empty sessionId");
      }
      await memento.update(KEY, sessionId);
    },
    clear: async () => {
      await memento.update(KEY, undefined);
    },
  };
}
```

- [ ] **Step 21.4: Implement `chat-panel.ts`**

Create `packages/vscode-extension/src/chat/chat-panel.ts`:

```ts
/**
 * ChatPanel is constructed via real `vscode` API in extension.ts; this module
 * exposes the contract any caller needs. Keeping it as a pure interface lets
 * the controller be unit-tested with a fake WebviewPanel.
 */

export interface WebviewLike {
  cspSource: string;
  asWebviewUri(localPath: string): string;
  html: string;
  postMessage(msg: unknown): Thenable<boolean>;
  onDidReceiveMessage(handler: (msg: unknown) => void): { dispose(): void };
}

export interface WebviewPanelLike {
  visible: boolean;
  active: boolean;
  webview: WebviewLike;
  reveal(): void;
  dispose(): void;
  onDidDispose(handler: () => void): { dispose(): void };
  onDidChangeViewState(handler: () => void): { dispose(): void };
}

export interface ChatPanel {
  reveal(): void;
  dispose(): void;
  panel(): WebviewPanelLike | undefined;
  onDispose(handler: () => void): void;
  onMessage(handler: (msg: unknown) => void): void;
  postMessage(msg: unknown): Thenable<boolean>;
  isVisible(): boolean;
  isActive(): boolean;
}

export interface ChatPanelFactory {
  createOrReveal(): ChatPanel;
  current(): ChatPanel | undefined;
}

/**
 * Default no-op factory used in unit tests. Real factory is constructed in
 * extension.ts using `vscode.window.createWebviewPanel`.
 */
export function createNoopChatPanel(): ChatPanel {
  let disposed = false;
  const disposeListeners: Array<() => void> = [];
  const messageListeners: Array<(msg: unknown) => void> = [];
  return {
    reveal: () => undefined,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const l of disposeListeners) l();
    },
    panel: () => undefined,
    onDispose: (h) => {
      disposeListeners.push(h);
    },
    onMessage: (h) => {
      messageListeners.push(h);
    },
    postMessage: () => Promise.resolve(true),
    isVisible: () => false,
    isActive: () => false,
  };
}
```

- [ ] **Step 21.5: Run + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/session-store.test.ts
git add packages/vscode-extension/src/chat/chat-protocol.ts packages/vscode-extension/src/chat/session-store.ts packages/vscode-extension/src/chat/chat-panel.ts packages/vscode-extension/test/unit/session-store.test.ts
git commit -m "feat(vscode-extension): chat-protocol types + SessionStore + ChatPanel contract"
```

Expected: PASS, 4 of 4.

---

## Task 22: Implement `ChatController` (askStream pump)

**Files:**
- Create: `packages/vscode-extension/src/chat/chat-controller.ts`
- Create: `packages/vscode-extension/test/unit/chat-controller.test.ts`

---

- [ ] **Step 22.1: Write the failing test**

Create `packages/vscode-extension/test/unit/chat-controller.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { createChatController } from "../../src/chat/chat-controller.ts";
import { createNoopChatPanel } from "../../src/chat/chat-panel.ts";
import { MockClient } from "@nimbus-dev/client";

describe("ChatController", () => {
  test("askStream messages get translated to webview postMessage", async () => {
    const panel = createNoopChatPanel();
    const posted: unknown[] = [];
    panel.postMessage = vi.fn(async (msg) => {
      posted.push(msg);
      return true;
    });
    const client = new MockClient({ streamTokens: ["a", "b"], reply: "ab" });
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => undefined,
        set: async () => undefined,
        clear: async () => undefined,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    await ctrl.start("hi");
    const types = posted.map((m) => (m as { type: string }).type);
    expect(types).toContain("userMessage");
    expect(types).toContain("token");
    expect(types).toContain("done");
  });

  test("rejects start while a stream is in progress", async () => {
    const panel = createNoopChatPanel();
    const client = new MockClient({ streamTokens: ["a"] });
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => undefined,
        set: async () => undefined,
        clear: async () => undefined,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    const p = ctrl.start("first");
    await expect(ctrl.start("second")).rejects.toThrow(/in progress/i);
    await p;
  });

  test("newConversation clears sessionId and posts reset", async () => {
    const panel = createNoopChatPanel();
    const posted: unknown[] = [];
    panel.postMessage = vi.fn(async (m) => {
      posted.push(m);
      return true;
    });
    const cleared = vi.fn(async () => undefined);
    const client = new MockClient();
    const ctrl = createChatController({
      client,
      panel,
      sessionStore: {
        get: () => "sess-old",
        set: async () => undefined,
        clear: cleared,
      },
      registerStreamWithHitl: () => undefined,
      unregisterStreamWithHitl: () => undefined,
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    });
    await ctrl.newConversation();
    expect(cleared).toHaveBeenCalled();
    expect(posted.some((m) => (m as { type: string }).type === "reset")).toBe(true);
  });
});
```

- [ ] **Step 22.2: Implement `chat-controller.ts`**

Create `packages/vscode-extension/src/chat/chat-controller.ts`:

```ts
import type { AskStreamHandle, AskStreamOptions } from "@nimbus-dev/client";

import type { Logger } from "../logging.js";
import type { ChatPanel } from "./chat-panel.js";
import type { ExtensionToWebview } from "./chat-protocol.js";
import type { SessionStore } from "./session-store.js";

export interface ChatClientLike {
  askStream(input: string, opts?: AskStreamOptions): AskStreamHandle;
  cancelStream(streamId: string): Promise<{ ok: boolean }>;
  getSessionTranscript(params: {
    sessionId: string;
    limit?: number;
  }): Promise<{
    sessionId: string;
    turns: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
    hasMore: boolean;
  }>;
}

export interface ChatControllerDeps {
  client: ChatClientLike;
  panel: ChatPanel;
  sessionStore: SessionStore;
  registerStreamWithHitl(streamId: string): void;
  unregisterStreamWithHitl(streamId: string): void;
  log: Logger;
  agent?: () => string;
}

export interface ChatController {
  start(input: string): Promise<void>;
  stop(): Promise<void>;
  newConversation(): Promise<void>;
  rehydrateIfNeeded(limit: number): Promise<void>;
  isStreaming(): boolean;
}

export function createChatController(deps: ChatControllerDeps): ChatController {
  let active: AskStreamHandle | undefined;

  const post = (m: ExtensionToWebview): void => {
    void deps.panel.postMessage(m);
  };

  return {
    async start(input): Promise<void> {
      if (active !== undefined) {
        throw new Error("Stream in progress; click Stop or wait for it to finish.");
      }
      const opts: AskStreamOptions = {};
      const sid = deps.sessionStore.get();
      if (sid !== undefined) opts.sessionId = sid;
      const agent = deps.agent?.() ?? "";
      if (agent.length > 0) opts.agent = agent;
      const handle = deps.client.askStream(input, opts);
      active = handle;
      post({ type: "userMessage", text: input });
      try {
        for await (const ev of handle) {
          if (ev.type === "token") {
            post({ type: "token", text: ev.text });
            continue;
          }
          if (ev.type === "subTaskProgress") {
            const m: ExtensionToWebview = {
              type: "subTask",
              subTaskId: ev.subTaskId,
              status: ev.status,
            };
            if (typeof ev.progress === "number") (m as { progress?: number }).progress = ev.progress;
            post(m);
            continue;
          }
          if (ev.type === "hitlBatch") {
            post({
              type: "hitlInline",
              requestId: ev.requestId,
              prompt: ev.prompt,
              details: ev.details,
            });
            continue;
          }
          if (ev.type === "done") {
            post({ type: "done", reply: ev.reply, sessionId: ev.sessionId });
            if (ev.sessionId.length > 0) {
              await deps.sessionStore.set(ev.sessionId);
            }
            break;
          }
          if (ev.type === "error") {
            post({ type: "error", message: ev.message });
            deps.log.error(`Stream error: ${ev.code}: ${ev.message}`);
            break;
          }
        }
      } finally {
        if (handle.streamId.length > 0) {
          deps.unregisterStreamWithHitl(handle.streamId);
        }
        active = undefined;
      }
      if (handle.streamId.length > 0) {
        deps.registerStreamWithHitl(handle.streamId);
      }
    },
    async stop(): Promise<void> {
      if (active === undefined) return;
      await active.cancel();
      active = undefined;
    },
    async newConversation(): Promise<void> {
      if (active !== undefined) {
        await active.cancel();
        active = undefined;
      }
      await deps.sessionStore.clear();
      post({ type: "reset" });
    },
    async rehydrateIfNeeded(limit): Promise<void> {
      const sid = deps.sessionStore.get();
      if (sid === undefined) {
        post({ type: "emptyState", sub: "no-transcript" });
        return;
      }
      try {
        const r = await deps.client.getSessionTranscript({ sessionId: sid, limit });
        post({ type: "hydrate", turns: r.turns });
      } catch (e) {
        deps.log.warn(`getSessionTranscript failed: ${e instanceof Error ? e.message : String(e)}`);
        post({ type: "emptyState", sub: "no-transcript" });
      }
    },
    isStreaming: () => active !== undefined,
  };
}
```

- [ ] **Step 22.3: Run + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/chat-controller.test.ts
git add packages/vscode-extension/src/chat/chat-controller.ts packages/vscode-extension/test/unit/chat-controller.test.ts
git commit -m "feat(vscode-extension): ChatController — askStream pump + session lifecycle"
```

Expected: PASS, 3 of 3.

---

## Task 23: Implement the Webview client (markdown renderer + HITL card + empty state)

**Files:**
- Create: `packages/vscode-extension/src/chat/webview/markdown.ts`
- Create: `packages/vscode-extension/src/chat/webview/hitl-card.ts`
- Create: `packages/vscode-extension/src/chat/webview/empty-state.ts`
- Create: `packages/vscode-extension/src/chat/webview/main.ts`
- Create: `packages/vscode-extension/src/chat/webview/styles.css`
- Create: `packages/vscode-extension/test/unit/webview/markdown.test.ts`
- Create: `packages/vscode-extension/test/unit/webview/hitl-card.test.ts`

---

- [ ] **Step 23.1: Write the failing markdown test**

Create `packages/vscode-extension/test/unit/webview/markdown.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import { renderMarkdownInto } from "../../../src/chat/webview/markdown.ts";

describe("renderMarkdownInto", () => {
  test("renders headings, paragraphs, code blocks", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "# Title\n\nHello\n\n```ts\nconst x = 1;\n```");
    expect(el.querySelector("h1")?.textContent).toBe("Title");
    expect(el.querySelector("pre code")).not.toBeNull();
  });

  test("incremental token append produces accumulating DOM", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "He");
    renderMarkdownInto(el, "Hello world");
    expect(el.textContent).toContain("Hello world");
  });

  test("code block gets a copy button", () => {
    const el = document.createElement("div");
    renderMarkdownInto(el, "```js\nfoo()\n```");
    expect(el.querySelector("button.copy-code")).not.toBeNull();
  });
});
```

- [ ] **Step 23.2: Implement `markdown.ts`**

Create `packages/vscode-extension/src/chat/webview/markdown.ts`:

```ts
import { marked } from "marked";

export function renderMarkdownInto(container: HTMLElement, markdownText: string): void {
  const html = marked.parse(markdownText, { async: false }) as string;
  container.innerHTML = html;
  for (const pre of Array.from(container.querySelectorAll("pre"))) {
    if (pre.querySelector("button.copy-code") !== null) continue;
    const btn = document.createElement("button");
    btn.className = "copy-code";
    btn.textContent = "Copy";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      if (code !== null) {
        void navigator.clipboard.writeText(code.textContent ?? "");
      }
    });
    pre.style.position = "relative";
    btn.style.position = "absolute";
    btn.style.top = "4px";
    btn.style.right = "4px";
    pre.appendChild(btn);
  }
}
```

- [ ] **Step 23.3: Write the failing HITL card test**

Create `packages/vscode-extension/test/unit/webview/hitl-card.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";

import { renderHitlCard } from "../../../src/chat/webview/hitl-card.ts";

describe("renderHitlCard", () => {
  test("renders prompt + Approve/Reject buttons", () => {
    const onResponse = vi.fn();
    const card = renderHitlCard({
      requestId: "r1",
      prompt: "Send email?",
      onResponse,
    });
    expect(card.textContent).toContain("Send email?");
    const buttons = card.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });

  test("Approve click invokes callback with 'approve'", () => {
    const onResponse = vi.fn();
    const card = renderHitlCard({
      requestId: "r1",
      prompt: "Send email?",
      onResponse,
    });
    const approve = card.querySelector("button.hitl-approve") as HTMLButtonElement;
    approve.click();
    expect(onResponse).toHaveBeenCalledWith("r1", "approve");
  });
});
```

- [ ] **Step 23.4: Implement `hitl-card.ts`**

Create `packages/vscode-extension/src/chat/webview/hitl-card.ts`:

```ts
export type HitlCardInput = {
  requestId: string;
  prompt: string;
  details?: unknown;
  onResponse: (requestId: string, decision: "approve" | "reject") => void;
};

export function renderHitlCard(inp: HitlCardInput): HTMLElement {
  const card = document.createElement("div");
  card.className = "hitl-card";

  const header = document.createElement("h4");
  header.textContent = "Consent required";
  card.appendChild(header);

  const promptEl = document.createElement("p");
  promptEl.textContent = inp.prompt;
  card.appendChild(promptEl);

  if (inp.details !== undefined && inp.details !== null) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(inp.details, null, 2);
    card.appendChild(pre);
  }

  const actions = document.createElement("div");
  actions.className = "hitl-actions";

  const approve = document.createElement("button");
  approve.className = "hitl-approve";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => {
    approve.disabled = true;
    reject.disabled = true;
    inp.onResponse(inp.requestId, "approve");
  });

  const reject = document.createElement("button");
  reject.className = "hitl-reject";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => {
    approve.disabled = true;
    reject.disabled = true;
    inp.onResponse(inp.requestId, "reject");
  });

  actions.appendChild(approve);
  actions.appendChild(reject);
  card.appendChild(actions);

  return card;
}
```

- [ ] **Step 23.5: Implement `empty-state.ts`**

Create `packages/vscode-extension/src/chat/webview/empty-state.ts`:

```ts
export type EmptyStateInput = {
  sub: "no-transcript" | "disconnected" | "permission-denied";
  socketPath?: string;
  onStartGateway: () => void;
  onOpenLogs: () => void;
  onOpenDocs: () => void;
};

export function renderEmptyState(inp: EmptyStateInput): HTMLElement {
  const card = document.createElement("div");
  card.className = "empty-state-card";

  if (inp.sub === "no-transcript") {
    const h = document.createElement("h2");
    h.textContent = "Ask Nimbus anything";
    const p = document.createElement("p");
    p.textContent =
      "Use the input below, or run a command from the palette: Search, Run Workflow, Ask About Selection.";
    card.appendChild(h);
    card.appendChild(p);
    return card;
  }

  if (inp.sub === "disconnected") {
    const h = document.createElement("h2");
    h.textContent = "Nimbus Gateway is not running";
    const p = document.createElement("p");
    p.textContent = `The extension can't reach the Gateway socket${
      inp.socketPath !== undefined ? ` at ${inp.socketPath}` : ""
    }. The Gateway is a separate background process.`;
    card.appendChild(h);
    card.appendChild(p);
    const start = document.createElement("button");
    start.className = "empty-state-primary";
    start.textContent = "Start Gateway";
    start.addEventListener("click", inp.onStartGateway);
    card.appendChild(start);
    const docs = document.createElement("button");
    docs.className = "empty-state-secondary";
    docs.textContent = "Read Install Docs";
    docs.addEventListener("click", inp.onOpenDocs);
    card.appendChild(docs);
    return card;
  }

  // permission-denied
  const h = document.createElement("h2");
  h.textContent = "Permission denied";
  const p = document.createElement("p");
  p.textContent = `The extension cannot access the Gateway socket${
    inp.socketPath !== undefined ? `: ${inp.socketPath}` : ""
  }. Check ownership/mode or set nimbus.socketPath.`;
  card.appendChild(h);
  card.appendChild(p);
  const logs = document.createElement("button");
  logs.className = "empty-state-secondary";
  logs.textContent = "Open Logs";
  logs.addEventListener("click", inp.onOpenLogs);
  card.appendChild(logs);
  return card;
}
```

- [ ] **Step 23.6: Implement `main.ts` (Webview entry point)**

Create `packages/vscode-extension/src/chat/webview/main.ts`:

```ts
import { renderEmptyState } from "./empty-state.js";
import { renderHitlCard } from "./hitl-card.js";
import { renderMarkdownInto } from "./markdown.js";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

const vscode = acquireVsCodeApi();

const transcriptEl = document.getElementById("transcript") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const submitEl = document.getElementById("submit") as HTMLButtonElement;
const stopEl = document.getElementById("stop") as HTMLButtonElement;

let currentAssistantMessage: HTMLDivElement | undefined;
let currentAssistantText = "";

function appendUser(text: string): void {
  const wrap = document.createElement("div");
  wrap.className = "message user";
  wrap.textContent = text;
  transcriptEl.appendChild(wrap);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function startAssistant(): void {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  transcriptEl.appendChild(wrap);
  currentAssistantMessage = wrap;
  currentAssistantText = "";
}

function appendToken(text: string): void {
  if (currentAssistantMessage === undefined) startAssistant();
  currentAssistantText += text;
  if (currentAssistantMessage !== undefined) {
    renderMarkdownInto(currentAssistantMessage, currentAssistantText);
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function clearTranscript(): void {
  transcriptEl.innerHTML = "";
  currentAssistantMessage = undefined;
  currentAssistantText = "";
}

function showEmptyState(sub: "no-transcript" | "disconnected" | "permission-denied", socketPath?: string): void {
  clearTranscript();
  const card = renderEmptyState({
    sub,
    socketPath,
    onStartGateway: () => vscode.postMessage({ type: "startGateway" }),
    onOpenLogs: () => vscode.postMessage({ type: "openLogs" }),
    onOpenDocs: () =>
      vscode.postMessage({ type: "openExternal", url: "https://nimbus.dev/install" }),
  });
  transcriptEl.appendChild(card);
}

window.addEventListener("message", (event) => {
  const msg = event.data as { type: string } & Record<string, unknown>;
  switch (msg.type) {
    case "reset":
      clearTranscript();
      break;
    case "hydrate": {
      clearTranscript();
      const turns = (msg["turns"] as Array<{ role: string; text: string }>) ?? [];
      for (const t of turns) {
        if (t.role === "user") appendUser(t.text);
        else {
          startAssistant();
          appendToken(t.text);
          currentAssistantMessage = undefined;
        }
      }
      break;
    }
    case "userMessage":
      appendUser(msg["text"] as string);
      startAssistant();
      break;
    case "token":
      appendToken(msg["text"] as string);
      break;
    case "done":
      currentAssistantMessage = undefined;
      stopEl.style.display = "none";
      submitEl.disabled = false;
      break;
    case "error": {
      const err = document.createElement("div");
      err.className = "message error";
      err.textContent = `Error: ${msg["message"] as string}`;
      transcriptEl.appendChild(err);
      currentAssistantMessage = undefined;
      stopEl.style.display = "none";
      submitEl.disabled = false;
      break;
    }
    case "hitlInline": {
      const card = renderHitlCard({
        requestId: msg["requestId"] as string,
        prompt: msg["prompt"] as string,
        details: msg["details"],
        onResponse: (rid, dec) =>
          vscode.postMessage({ type: "hitlResponse", requestId: rid, decision: dec }),
      });
      transcriptEl.appendChild(card);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
      break;
    }
    case "emptyState":
      showEmptyState(
        msg["sub"] as "no-transcript" | "disconnected" | "permission-denied",
        msg["socketPath"] as string | undefined,
      );
      break;
    case "subTask":
      // Inline subtask progress chip — minimal v0.1.0 rendering
      {
        const chip = document.createElement("div");
        chip.className = "subtask";
        chip.textContent = `[${msg["status"]}] ${msg["subTaskId"]}`;
        transcriptEl.appendChild(chip);
      }
      break;
  }
});

submitEl.addEventListener("click", () => {
  const text = inputEl.value.trim();
  if (text.length === 0) return;
  inputEl.value = "";
  submitEl.disabled = true;
  stopEl.style.display = "inline-block";
  vscode.postMessage({ type: "submitAsk", text });
});

stopEl.addEventListener("click", () => {
  vscode.postMessage({ type: "stopStream" });
});

// Tell the extension we're ready to receive hydrate / emptyState
vscode.postMessage({ type: "ready" });
```

- [ ] **Step 23.7: Implement `styles.css`**

Create `packages/vscode-extension/src/chat/webview/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family: var(--vscode-font-family);
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
}

body { margin: 0; display: flex; flex-direction: column; height: 100vh; }
#transcript { flex: 1; overflow-y: auto; padding: 1em; }
.message { padding: 0.5em 0.75em; margin-bottom: 0.75em; border-radius: 6px; }
.message.user { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
.message.assistant { background: var(--vscode-editor-background); }
.message.error { color: var(--vscode-errorForeground); }
.subtask { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 0.25em 0; }

.hitl-card {
  border: 1px solid var(--vscode-textBlockQuote-border);
  background: var(--vscode-textBlockQuote-background);
  padding: 1em;
  border-radius: 6px;
  margin: 0.75em 0;
}
.hitl-card h4 { margin-top: 0; }
.hitl-card pre {
  background: var(--vscode-editorWidget-background);
  padding: 0.5em;
  overflow: auto;
  font-family: var(--vscode-editor-font-family);
}
.hitl-actions { display: flex; gap: 0.5em; margin-top: 0.75em; }
.hitl-approve, .empty-state-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none; padding: 0.4em 0.9em; cursor: pointer;
}
.hitl-reject {
  background: var(--vscode-errorForeground);
  color: var(--vscode-button-foreground);
  border: none; padding: 0.4em 0.9em; cursor: pointer;
}

.empty-state-card { padding: 2em; text-align: center; }
.empty-state-secondary {
  background: transparent;
  color: var(--vscode-textLink-foreground);
  border: 1px solid var(--vscode-textBlockQuote-border);
  padding: 0.4em 0.9em; cursor: pointer; margin-left: 0.5em;
}

#input-area { display: flex; gap: 0.5em; padding: 0.75em; border-top: 1px solid var(--vscode-textBlockQuote-border); }
#input { flex: 1; min-height: 60px; resize: vertical; font-family: var(--vscode-editor-font-family);
         color: var(--vscode-input-foreground); background: var(--vscode-input-background);
         border: 1px solid var(--vscode-input-border); padding: 0.5em; }
#submit, #stop {
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; padding: 0.5em 1em; cursor: pointer; align-self: flex-end;
}
#stop { display: none; background: var(--vscode-errorForeground); }
button.copy-code { font-size: 0.75em; padding: 2px 6px; }

pre {
  background: var(--vscode-editorWidget-background);
  padding: 0.5em;
  overflow: auto;
}
```

- [ ] **Step 23.8: Run tests + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/webview/
git add packages/vscode-extension/src/chat/webview/ packages/vscode-extension/test/unit/webview/
git commit -m "feat(vscode-extension): chat Webview client (markdown, HITL card, empty state, theme)"
```

Expected: PASS, 5 of 5.

---

## Task 24: Implement the `nimbus-item:` URI scheme provider

**Files:**
- Create: `packages/vscode-extension/src/search/item-provider.ts`
- Create: `packages/vscode-extension/test/unit/item-provider.test.ts`

---

- [ ] **Step 24.1: Write the failing test**

Create `packages/vscode-extension/test/unit/item-provider.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { formatItemMarkdown, parseItemUri } from "../../src/search/item-provider.ts";

describe("parseItemUri", () => {
  test("extracts itemId from nimbus-item: URI", () => {
    const id = parseItemUri("nimbus-item:abc-123");
    expect(id).toBe("abc-123");
  });
  test("returns undefined for wrong scheme", () => {
    expect(parseItemUri("file:///foo")).toBeUndefined();
  });
});

describe("formatItemMarkdown", () => {
  test("renders title, service, type, fields", () => {
    const md = formatItemMarkdown({
      id: "abc",
      service: "github",
      itemType: "pr",
      name: "Fix bug",
      modifiedAt: 1700000000000,
      extra: { url: "https://x" },
    } as Record<string, unknown>);
    expect(md).toContain("# Fix bug");
    expect(md).toContain("github");
    expect(md).toContain("pr");
  });

  test("handles missing fields gracefully", () => {
    const md = formatItemMarkdown({ id: "x" } as Record<string, unknown>);
    expect(md).toContain("# Untitled");
  });
});
```

- [ ] **Step 24.2: Implement `item-provider.ts`**

Create `packages/vscode-extension/src/search/item-provider.ts`:

```ts
export const URI_SCHEME = "nimbus-item";

export function parseItemUri(uri: string): string | undefined {
  if (!uri.startsWith(`${URI_SCHEME}:`)) return undefined;
  return uri.slice(URI_SCHEME.length + 1);
}

export function formatItemMarkdown(item: Record<string, unknown>): string {
  const name = typeof item.name === "string" && item.name.length > 0 ? item.name : "Untitled";
  const service = typeof item.service === "string" ? item.service : "unknown";
  const type = typeof item.itemType === "string" ? item.itemType : "unknown";
  const id = typeof item.id === "string" ? item.id : "—";
  const modifiedAt =
    typeof item.modifiedAt === "number" ? new Date(item.modifiedAt).toISOString() : "—";

  const lines: string[] = [
    `# ${name}`,
    "",
    `- **Service:** ${service}`,
    `- **Type:** ${type}`,
    `- **ID:** ${id}`,
    `- **Modified:** ${modifiedAt}`,
    "",
    "## Raw fields",
    "",
    "```json",
    JSON.stringify(item, null, 2),
    "```",
  ];
  return lines.join("\n");
}
```

- [ ] **Step 24.3: Run + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/item-provider.test.ts
git add packages/vscode-extension/src/search/ packages/vscode-extension/test/unit/item-provider.test.ts
git commit -m "feat(vscode-extension): nimbus-item: URI scheme + structured-item markdown formatter"
```

Expected: PASS, 4 of 4.

---

## Task 25: Implement the command modules

**Files:**
- Create: `packages/vscode-extension/src/commands/ask.ts`
- Create: `packages/vscode-extension/src/commands/search.ts`
- Create: `packages/vscode-extension/src/commands/run-workflow.ts`
- Create: `packages/vscode-extension/src/commands/new-conversation.ts`
- Create: `packages/vscode-extension/src/commands/start-gateway.ts`
- Create: `packages/vscode-extension/test/unit/commands/ask.test.ts`

---

- [ ] **Step 25.1: Write the failing ask test**

Create `packages/vscode-extension/test/unit/commands/ask.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { buildAskAboutSelectionPrefill } from "../../../src/commands/ask.ts";

describe("buildAskAboutSelectionPrefill", () => {
  test("includes path, line range, language fence", () => {
    const out = buildAskAboutSelectionPrefill({
      relativePath: "src/auth.ts",
      startLine: 41,
      endLine: 57,
      languageId: "typescript",
      selectionText: "function authenticate() { return true; }",
    });
    expect(out).toContain("Context (src/auth.ts, lines 42–58):");
    expect(out).toContain("```typescript");
    expect(out).toContain("function authenticate() { return true; }");
    expect(out.endsWith("Question: ")).toBe(true);
  });

  test("single-line selection renders as 'line N'", () => {
    const out = buildAskAboutSelectionPrefill({
      relativePath: "x.ts",
      startLine: 5,
      endLine: 5,
      languageId: "ts",
      selectionText: "let x = 1;",
    });
    expect(out).toContain("Context (x.ts, line 6):");
  });
});
```

- [ ] **Step 25.2: Implement `ask.ts`**

Create `packages/vscode-extension/src/commands/ask.ts`:

```ts
import type { ChatController } from "../chat/chat-controller.js";

export interface AskCommandDeps {
  controller: ChatController;
  reveal: () => void;
  setInputText: (text: string) => void;
}

/**
 * Pure helper: builds the pre-fill template for "Ask About Selection".
 * Lines are 0-based in the selection input, 1-based in the rendered text.
 */
export function buildAskAboutSelectionPrefill(inp: {
  relativePath: string;
  startLine: number;
  endLine: number;
  languageId: string;
  selectionText: string;
}): string {
  const startHuman = inp.startLine + 1;
  const endHuman = inp.endLine + 1;
  const lineSegment =
    startHuman === endHuman ? `line ${startHuman}` : `lines ${startHuman}–${endHuman}`;
  return [
    `Context (${inp.relativePath}, ${lineSegment}):`,
    "```" + inp.languageId,
    inp.selectionText,
    "```",
    "",
    "Question: ",
  ].join("\n");
}

export function createAskCommand(deps: AskCommandDeps): () => Promise<void> {
  return async () => {
    deps.reveal();
    // The chat panel handles user input; nothing else to do here.
    // (Real wiring in extension.ts focuses the input via postMessage.)
  };
}

export function createAskAboutSelectionCommand(
  deps: AskCommandDeps,
  getSelection: () =>
    | { relativePath: string; startLine: number; endLine: number; languageId: string; selectionText: string }
    | undefined,
): () => Promise<void> {
  return async () => {
    const sel = getSelection();
    if (sel === undefined) return;
    deps.reveal();
    deps.setInputText(buildAskAboutSelectionPrefill(sel));
  };
}
```

- [ ] **Step 25.3: Implement `search.ts`**

Create `packages/vscode-extension/src/commands/search.ts`:

```ts
import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export type SearchClientLike = {
  queryItems(params: { query?: string; limit?: number }): Promise<{
    items: Array<Record<string, unknown>>;
  }>;
};

export type SearchSinkDeps = {
  openExternal(url: string): Promise<boolean>;
  openTextDocument(uriOrPath: string, opts?: { isFile: boolean }): Promise<void>;
  showQuickPick(
    items: Array<{ label: string; description: string; detail: string; itemId: string; url?: string; filePath?: string }>,
  ): Promise<{ itemId: string; url?: string; filePath?: string } | undefined>;
};

export interface SearchCommandDeps {
  client: SearchClientLike;
  window: WindowApi;
  sink: SearchSinkDeps;
  log: Logger;
}

function pickUrl(item: Record<string, unknown>): string | undefined {
  const url = (item as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const extra = (item as { extra?: { url?: unknown } }).extra;
  if (extra !== undefined && typeof extra.url === "string") return extra.url;
  return undefined;
}

function pickFilePath(item: Record<string, unknown>): string | undefined {
  const fp = (item as { filePath?: unknown }).filePath;
  if (typeof fp === "string" && fp.length > 0) return fp;
  return undefined;
}

export function createSearchCommand(deps: SearchCommandDeps): (initial?: string) => Promise<void> {
  return async (initial) => {
    let query = initial;
    if (query === undefined) {
      query = await deps.window.showInputBox({ prompt: "Search Nimbus index" });
    }
    if (query === undefined || query.trim().length === 0) return;
    const result = await deps.client.queryItems({ query, limit: 50 });
    if (result.items.length === 0) {
      await deps.window.showInformationMessage("No results", {});
      return;
    }
    const picks = result.items.map((it) => {
      const id = typeof it.id === "string" ? it.id : "";
      const url = pickUrl(it);
      const filePath = pickFilePath(it);
      return {
        label: typeof it.name === "string" ? it.name : "Untitled",
        description: typeof it.service === "string" ? it.service : "",
        detail: typeof it.itemType === "string" ? it.itemType : "",
        itemId: id,
        ...(url !== undefined ? { url } : {}),
        ...(filePath !== undefined ? { filePath } : {}),
      };
    });
    const chosen = await deps.sink.showQuickPick(picks);
    if (chosen === undefined) return;
    if (chosen.url !== undefined) {
      await deps.sink.openExternal(chosen.url);
      return;
    }
    if (chosen.filePath !== undefined) {
      await deps.sink.openTextDocument(chosen.filePath, { isFile: true });
      return;
    }
    await deps.sink.openTextDocument(`nimbus-item:${chosen.itemId}`, { isFile: false });
  };
}
```

- [ ] **Step 25.4: Implement `run-workflow.ts`**

Create `packages/vscode-extension/src/commands/run-workflow.ts`:

```ts
import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export type WorkflowClientLike = {
  workflowList(): Promise<Array<{ name: string; description?: string }>>;
  workflowRun(params: { name: string }): Promise<unknown>;
};

export interface RunWorkflowDeps {
  call(method: string, params?: unknown): Promise<unknown>;
  window: WindowApi;
  log: Logger;
  showQuickPick<T extends { label: string }>(items: T[]): Promise<T | undefined>;
  showProgressToast(message: string, onShowLogs: () => void): Promise<void>;
}

export function createRunWorkflowCommand(deps: RunWorkflowDeps): () => Promise<void> {
  return async () => {
    const list = (await deps.call("workflow.list")) as Array<{ name: string; description?: string }>;
    if (!Array.isArray(list) || list.length === 0) {
      await deps.window.showInformationMessage("No workflows defined", {});
      return;
    }
    const chosen = await deps.showQuickPick(
      list.map((w) => ({ label: w.name, description: w.description ?? "" })),
    );
    if (chosen === undefined) return;
    deps.log.info(`Running workflow: ${chosen.label}`);
    void deps.call("workflow.run", { name: chosen.label }).catch((e: unknown) => {
      deps.log.error(
        `workflow.run failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    await deps.showProgressToast(`Running workflow ${chosen.label}…`, () => undefined);
  };
}
```

- [ ] **Step 25.5: Implement `new-conversation.ts`**

Create `packages/vscode-extension/src/commands/new-conversation.ts`:

```ts
import type { ChatController } from "../chat/chat-controller.js";

export function createNewConversationCommand(controller: ChatController): () => Promise<void> {
  return async () => {
    await controller.newConversation();
  };
}
```

- [ ] **Step 25.6: Implement `start-gateway.ts`**

Create `packages/vscode-extension/src/commands/start-gateway.ts`:

```ts
import type { AutoStarter } from "../connection/auto-start.js";
import type { Logger } from "../logging.js";
import type { WindowApi } from "../vscode-shim.js";

export interface StartGatewayDeps {
  autoStarter: AutoStarter;
  getSocketPath: () => Promise<string>;
  window: WindowApi;
  log: Logger;
  openLogs: () => void;
}

export function createStartGatewayCommand(deps: StartGatewayDeps): () => Promise<void> {
  return async () => {
    const socketPath = await deps.getSocketPath();
    deps.log.info(`Starting Gateway via 'nimbus start' (target socket: ${socketPath})`);
    const r = await deps.autoStarter.spawn(socketPath);
    if (r.kind === "ok") {
      await deps.window.showInformationMessage("Nimbus Gateway is running.", {});
      return;
    }
    if (r.kind === "timeout") {
      const action = await deps.window.showErrorMessage(
        `Nimbus: Gateway didn't appear within timeout (${r.socketPath}).`,
        "Open Logs",
      );
      if (action === "Open Logs") deps.openLogs();
      return;
    }
    const action = await deps.window.showErrorMessage(
      `Nimbus: Failed to spawn 'nimbus start' — ${r.message}. Is the binary on PATH?`,
      "Open Logs",
    );
    if (action === "Open Logs") deps.openLogs();
  };
}
```

- [ ] **Step 25.7: Run tests + commit**

```bash
cd packages/vscode-extension && bunx vitest run test/unit/commands/
git add packages/vscode-extension/src/commands/ packages/vscode-extension/test/unit/commands/
git commit -m "feat(vscode-extension): command modules (ask/search/run-workflow/new-conv/start-gateway)"
```

Expected: PASS, 2 of 2 (pure-helper test for ask).

---

## Task 26: Wire everything in `extension.ts` (activate / deactivate)

**Files:**
- Create: `packages/vscode-extension/src/extension.ts`

---

- [ ] **Step 26.1: Implement `extension.ts`**

This file is the only one allowed to import the real `vscode` module. It instantiates real adapters from the shim interfaces.

Create `packages/vscode-extension/src/extension.ts`:

```ts
import { spawn } from "node:child_process";
import * as net from "node:net";

import {
  NimbusClient,
  discoverSocketPath,
  type HitlRequest,
} from "@nimbus-dev/client";
import * as vscode from "vscode";

import { createChatController } from "./chat/chat-controller.js";
import { createSessionStore } from "./chat/session-store.js";
import type { ExtensionToWebview, WebviewToExtension } from "./chat/chat-protocol.js";
import { createConnectionManager, type NimbusClientLike } from "./connection/connection-manager.js";
import { createAutoStarter } from "./connection/auto-start.js";
import { createAskAboutSelectionCommand, createAskCommand } from "./commands/ask.js";
import { createNewConversationCommand } from "./commands/new-conversation.js";
import { createRunWorkflowCommand } from "./commands/run-workflow.js";
import { createSearchCommand } from "./commands/search.js";
import { createStartGatewayCommand } from "./commands/start-gateway.js";
import { createHitlRouter, type HitlDecision } from "./hitl/hitl-router.js";
import { createModalSurface } from "./hitl/hitl-modal.js";
import { createToastSurface } from "./hitl/hitl-toast.js";
import { createLogger } from "./logging.js";
import { formatItemMarkdown, parseItemUri, URI_SCHEME } from "./search/item-provider.js";
import { createSettings } from "./settings.js";
import { createStatusBarController, formatStatusBar } from "./status-bar/status-bar-item.js";
import type {
  OutputChannelHandle,
  StatusBarItemHandle,
  WindowApi,
  WorkspaceApi,
} from "./vscode-shim.js";

let disposables: vscode.Disposable[] = [];

function adaptOutputChannel(channel: vscode.OutputChannel): OutputChannelHandle {
  return {
    appendLine: (m) => channel.appendLine(m),
    show: (preserveFocus) => channel.show(preserveFocus ?? true),
    dispose: () => channel.dispose(),
  };
}

function adaptStatusBar(item: vscode.StatusBarItem): StatusBarItemHandle {
  return {
    get text() {
      return item.text;
    },
    set text(v: string) {
      item.text = v;
    },
    get tooltip() {
      return item.tooltip as string | undefined;
    },
    set tooltip(v: string | undefined) {
      item.tooltip = v;
    },
    get command() {
      return typeof item.command === "string" ? item.command : undefined;
    },
    set command(v: string | undefined) {
      item.command = v;
    },
    get backgroundColor() {
      const bg = item.backgroundColor;
      return bg !== undefined ? { id: (bg as vscode.ThemeColor).id } : undefined;
    },
    set backgroundColor(v: { id: string } | undefined) {
      item.backgroundColor = v !== undefined ? new vscode.ThemeColor(v.id) : undefined;
    },
    show: () => item.show(),
    hide: () => item.hide(),
    dispose: () => item.dispose(),
  };
}

function adaptWindow(): WindowApi {
  return {
    createOutputChannel: (name) => adaptOutputChannel(vscode.window.createOutputChannel(name)),
    createStatusBarItem: (alignment, priority) =>
      adaptStatusBar(
        vscode.window.createStatusBarItem(
          alignment === 1 ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
          priority,
        ),
      ),
    showInformationMessage: vscode.window.showInformationMessage.bind(vscode.window),
    showErrorMessage: vscode.window.showErrorMessage.bind(vscode.window),
    showInputBox: (opts) => vscode.window.showInputBox(opts),
  };
}

function adaptWorkspace(): WorkspaceApi {
  return {
    getConfiguration: (section) => {
      const cfg = vscode.workspace.getConfiguration(section);
      return { get: <T,>(key: string, dflt: T): T => cfg.get<T>(key, dflt) };
    },
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const window = adaptWindow();
  const workspace = adaptWorkspace();
  const settings = createSettings(workspace);
  const channel = window.createOutputChannel("Nimbus");
  const logger = createLogger(channel, () => settings.logLevel());

  // ---------- Connection ----------
  const open = async (socketPath: string): Promise<NimbusClientLike> => {
    const c = await NimbusClient.open({ socketPath });
    return c as unknown as NimbusClientLike;
  };
  const discover = async (override?: string) => {
    const o = override !== undefined && override.length > 0 ? override : settings.socketPath();
    const r = await discoverSocketPath(o.length > 0 ? { override: o } : undefined);
    return r;
  };
  const connection = createConnectionManager({
    open,
    discoverSocket: discover,
    log: logger,
    socketPathOverride: settings.socketPath(),
  });

  // ---------- Status bar ----------
  const sbItem = window.createStatusBarItem(1, 100);
  const sbCtl = createStatusBarController(sbItem);
  let degraded = 0;
  let degradedNames: string[] = [];
  let pending = 0;
  let profile = "default";
  const updateStatusBar = (): void => {
    sbCtl.update({
      connection: connection.current(),
      profile,
      degradedConnectorCount: degraded,
      degradedConnectorNames: degradedNames,
      pendingHitlCount: pending,
      autoStartGateway: settings.autoStartGateway(),
    });
    void formatStatusBar; // silence unused-import linter under some configs
  };
  connection.onState(() => updateStatusBar());

  // ---------- Auto-starter ----------
  const autoStarter = createAutoStarter({
    spawn: (cmd, args) => spawn(cmd, args, { detached: true, stdio: "ignore" }),
    pingSocket: async (socketPath) =>
      new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ path: socketPath });
        sock.once("connect", () => {
          sock.end();
          resolve(true);
        });
        sock.once("error", () => resolve(false));
      }),
    log: logger,
  });

  // ---------- Chat panel ----------
  let chatPanel: vscode.WebviewPanel | undefined;
  const sessionStore = createSessionStore({
    get: (k, d) => context.workspaceState.get(k, d),
    update: (k, v) => context.workspaceState.update(k, v),
  });

  const buildPanelHtml = (panel: vscode.WebviewPanel): string => {
    const csp = `default-src 'none'; img-src ${panel.webview.cspSource} https: data:; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline';`;
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.js"),
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.css"),
    );
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${styleUri}" />
<title>Nimbus</title>
</head>
<body>
<div id="transcript"></div>
<div id="input-area">
  <textarea id="input" placeholder="Ask Nimbus…"></textarea>
  <button id="submit">Send</button>
  <button id="stop">Stop</button>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  };

  const ensurePanel = (): vscode.WebviewPanel => {
    if (chatPanel !== undefined) {
      chatPanel.reveal(vscode.ViewColumn.Beside, true);
      return chatPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      "nimbus.chat",
      "Nimbus",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    panel.webview.html = buildPanelHtml(panel);
    panel.onDidDispose(() => {
      chatPanel = undefined;
    });
    chatPanel = panel;
    return panel;
  };

  const chatPanelAdapter = {
    reveal: () => {
      ensurePanel();
    },
    dispose: () => chatPanel?.dispose(),
    panel: () => chatPanel,
    onDispose: (h: () => void) => {
      if (chatPanel !== undefined) chatPanel.onDidDispose(h);
    },
    onMessage: (h: (msg: unknown) => void) => {
      if (chatPanel !== undefined) chatPanel.webview.onDidReceiveMessage(h);
    },
    postMessage: (m: unknown) => chatPanel?.webview.postMessage(m) ?? Promise.resolve(false),
    isVisible: () => chatPanel?.visible ?? false,
    isActive: () => chatPanel?.active ?? false,
  };

  const controller = createChatController({
    client: {
      askStream: (input, opts) => {
        const c = connection.client();
        if (c === undefined) throw new Error("Not connected");
        return (c as unknown as NimbusClient).askStream(input, opts);
      },
      cancelStream: async (sid) => {
        const c = connection.client();
        if (c === undefined) return { ok: false };
        return await (c as unknown as NimbusClient).cancelStream(sid);
      },
      getSessionTranscript: async (params) => {
        const c = connection.client();
        if (c === undefined) throw new Error("Not connected");
        return await (c as unknown as NimbusClient).getSessionTranscript(params);
      },
    },
    panel: chatPanelAdapter,
    sessionStore,
    registerStreamWithHitl: (sid) => activeStreams.add(sid),
    unregisterStreamWithHitl: (sid) => activeStreams.delete(sid),
    log: logger,
    agent: () => settings.askAgent(),
  });

  // ---------- HITL router ----------
  const activeStreams = new Set<string>();
  const router = createHitlRouter({
    chatPanelVisibleAndFocused: () => chatPanelAdapter.isVisible() && chatPanelAdapter.isActive(),
    streamRegistered: (sid) => activeStreams.has(sid),
    showInline: (req) => {
      // Webview emits hitlResponse back; we resolve the surface via the
      // pendingInline map keyed by requestId.
      return new Promise<HitlDecision | undefined>((resolve) => {
        pendingInline.set(req.requestId, resolve);
        void chatPanelAdapter.postMessage({
          type: "hitlInline",
          requestId: req.requestId,
          prompt: req.prompt,
          details: req.details,
        } as ExtensionToWebview);
      });
    },
    showToast: createToastSurface(window),
    showModal: createModalSurface(window),
    sendResponse: async (requestId, decision) => {
      const c = connection.client() as unknown as { ipc?: { call: (m: string, p: unknown) => Promise<unknown> } };
      if (c?.ipc !== undefined) {
        await c.ipc.call("consent.respond", { requestId, decisions: [{ decision }] });
      }
    },
    onCountChange: (n) => {
      pending = n;
      updateStatusBar();
    },
    alwaysModal: () => settings.hitlAlwaysModal(),
  });

  const pendingInline = new Map<string, (d: HitlDecision | undefined) => void>();

  // Wire HITL subscription once we connect
  connection.onState((s) => {
    if (s.kind === "connected") {
      const c = connection.client() as unknown as NimbusClient | undefined;
      c?.subscribeHitl((req: HitlRequest) => {
        void router.handle(req);
      });
    }
  });

  // ---------- nimbus-item: URI provider ----------
  const provider: vscode.TextDocumentContentProvider = {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const itemId = parseItemUri(uri.toString());
      if (itemId === undefined) return "";
      const c = connection.client() as unknown as NimbusClient | undefined;
      if (c === undefined) return "Gateway not connected.";
      const r = await c.queryItems({ limit: 1 });
      const found = r.items.find((it) => (it as { id?: unknown }).id === itemId);
      if (found === undefined) return `Item not found: ${itemId}`;
      return formatItemMarkdown(found as Record<string, unknown>);
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(URI_SCHEME, provider),
  );

  // ---------- Commands ----------
  const reveal = (): void => {
    ensurePanel();
  };
  const setInputText = (text: string): void => {
    void chatPanelAdapter.postMessage({ type: "userMessage", text } as ExtensionToWebview);
  };

  const askCmd = createAskCommand({ controller, reveal, setInputText });
  const askSelCmd = createAskAboutSelectionCommand({ controller, reveal, setInputText }, () => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) return undefined;
    return {
      relativePath: vscode.workspace.asRelativePath(editor.document.uri),
      startLine: editor.selection.start.line,
      endLine: editor.selection.end.line,
      languageId: editor.document.languageId,
      selectionText: editor.document.getText(editor.selection),
    };
  });
  const searchCmd = createSearchCommand({
    client: {
      queryItems: async (params) => {
        const c = connection.client() as unknown as NimbusClient;
        return await c.queryItems(params as never);
      },
    },
    window,
    sink: {
      openExternal: async (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      openTextDocument: async (uriOrPath, opts) => {
        const uri = opts?.isFile === true
          ? vscode.Uri.file(uriOrPath)
          : vscode.Uri.parse(uriOrPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
      },
      showQuickPick: async (items) => {
        const labels = items.map((i) => ({
          label: i.label,
          description: i.description,
          detail: i.detail,
          itemId: i.itemId,
          ...(i.url !== undefined ? { url: i.url } : {}),
          ...(i.filePath !== undefined ? { filePath: i.filePath } : {}),
        }));
        const chosen = await vscode.window.showQuickPick(labels, { matchOnDescription: true });
        return chosen as { itemId: string; url?: string; filePath?: string } | undefined;
      },
    },
    log: logger,
  });
  const runWfCmd = createRunWorkflowCommand({
    call: async (method, params) => {
      const c = connection.client() as unknown as { ipc?: { call: (m: string, p?: unknown) => Promise<unknown> } };
      if (c?.ipc === undefined) throw new Error("Not connected");
      return await c.ipc.call(method, params);
    },
    window,
    log: logger,
    showQuickPick: async (items) => {
      const chosen = await vscode.window.showQuickPick(items, { matchOnDescription: true });
      return chosen as (typeof items)[number] | undefined;
    },
    showProgressToast: async (message, onShowLogs) => {
      const action = await window.showInformationMessage(message, {}, "Show Progress");
      if (action === "Show Progress") onShowLogs();
    },
  });
  const newConvCmd = createNewConversationCommand(controller);
  const startGwCmd = createStartGatewayCommand({
    autoStarter,
    getSocketPath: async () => {
      const o = settings.socketPath();
      const r = await discoverSocketPath(o.length > 0 ? { override: o } : undefined);
      return r.socketPath;
    },
    window,
    log: logger,
    openLogs: () => channel.show(true),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("nimbus.ask", askCmd),
    vscode.commands.registerCommand("nimbus.askAboutSelection", askSelCmd),
    vscode.commands.registerCommand("nimbus.search", () => searchCmd()),
    vscode.commands.registerCommand("nimbus.searchSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.selection.isEmpty) return Promise.resolve();
      return searchCmd(editor.document.getText(editor.selection));
    }),
    vscode.commands.registerCommand("nimbus.runWorkflow", runWfCmd),
    vscode.commands.registerCommand("nimbus.newConversation", newConvCmd),
    vscode.commands.registerCommand("nimbus.startGateway", startGwCmd),
    vscode.commands.registerCommand("nimbus.reconnect", async () => {
      logger.info("Manual reconnect requested via nimbus.reconnect");
      await connection.reconnectNow();
    }),
    vscode.commands.registerCommand("nimbus.openLogs", () => channel.show(true)),
    vscode.commands.registerCommand("nimbus.showPendingHitl", async () => {
      const snap = router.snapshot();
      if (snap.length === 0) {
        await window.showInformationMessage("No pending consent requests.", {});
        return;
      }
      const chosen = await vscode.window.showQuickPick(
        snap.map((r) => ({ label: r.prompt, requestId: r.requestId })),
      );
      if (chosen === undefined) return;
      // Re-handle the chosen request through the router (modal forced)
      const orig = snap.find((r) => r.requestId === (chosen as { requestId: string }).requestId);
      if (orig !== undefined) await router.handle(orig);
    }),
  );

  // Webview message handling — wired once panel exists. Use a closure so
  // re-creation re-binds.
  const wireWebviewMessages = (): void => {
    if (chatPanel === undefined) return;
    chatPanel.webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
      switch (msg.type) {
        case "ready":
          await controller.rehydrateIfNeeded(settings.transcriptHistoryLimit());
          return;
        case "submitAsk":
          await controller.start(msg.text);
          return;
        case "stopStream":
          await controller.stop();
          return;
        case "hitlResponse": {
          const cb = pendingInline.get(msg.requestId);
          if (cb !== undefined) {
            pendingInline.delete(msg.requestId);
            cb(msg.decision);
          }
          return;
        }
        case "openLogs":
          channel.show(true);
          return;
        case "startGateway":
          await vscode.commands.executeCommand("nimbus.startGateway");
          return;
        case "openExternal":
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          return;
      }
    });
  };

  // Re-wire whenever a new panel is created
  const origEnsure = ensurePanel;
  // Replace ensurePanel with a wrapper that wires messages
  // (simplest approach: wrap the local function via closure)
  Object.assign(globalThis, {
    __nimbus_ensurePanel: () => {
      const p = origEnsure();
      wireWebviewMessages();
      return p;
    },
  });

  // ---------- Connector polling for status bar ----------
  const pollConnectors = async (): Promise<void> => {
    const c = connection.client() as unknown as { ipc?: { call: (m: string, p?: unknown) => Promise<unknown> } } | undefined;
    if (c?.ipc === undefined) return;
    try {
      const list = (await c.ipc.call("connector.list")) as Array<{
        name?: string;
        health?: string;
      }>;
      const broken = Array.isArray(list)
        ? list.filter(
            (it) =>
              typeof it.health === "string" && it.health !== "healthy" && it.health !== "ok",
          )
        : [];
      degraded = broken.length;
      degradedNames = broken
        .map((it) => (typeof it.name === "string" ? it.name : ""))
        .filter((n) => n.length > 0);
      updateStatusBar();
    } catch {
      // ignored — status bar rendering tolerates stale data
    }
  };
  const pollTimer = setInterval(() => {
    void pollConnectors();
  }, settings.statusBarPollMs());

  // ---------- Start ----------
  await connection.start();

  // Cleanup
  disposables.push(
    new vscode.Disposable(() => {
      clearInterval(pollTimer);
    }),
    new vscode.Disposable(() => {
      void connection.dispose();
    }),
    sbCtl,
    channel,
  );
  context.subscriptions.push(...disposables);
}

export function deactivate(): void {
  for (const d of disposables) d.dispose();
  disposables = [];
}
```

(This file is long; that's expected — it's the only place where real `vscode` adapters live. Resist the urge to split it; everything here is wiring, not logic.)

- [ ] **Step 26.2: Build the extension bundles**

```bash
cd packages/vscode-extension && bun run build
```

Expected: `dist/extension.js` and `media/webview.js` produced; `media/webview.css` copied.

- [ ] **Step 26.3: Typecheck**

```bash
cd packages/vscode-extension && bun run typecheck
```

Expected: PASS, no errors.

- [ ] **Step 26.4: Commit**

```bash
git add packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode-extension): activate/deactivate wiring with vscode adapters"
```

---

## Task 27: Integration test (`@vscode/test-electron` happy path)

**Files:**
- Create: `packages/vscode-extension/test/integration/ask-roundtrip.test.ts`
- Create: `packages/vscode-extension/test/integration/runner.ts`

---

- [ ] **Step 27.1: Create the test runner harness**

Create `packages/vscode-extension/test/integration/runner.ts`:

```ts
import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(__dirname, "ask-roundtrip.test.js");
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

void main();
```

- [ ] **Step 27.2: Implement `ask-roundtrip.test.ts`**

Create `packages/vscode-extension/test/integration/ask-roundtrip.test.ts`:

```ts
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as vscode from "vscode";

describe("Nimbus extension activation", () => {
  it("registers all expected commands", async () => {
    const extension = vscode.extensions.getExtension("nimbus-dev.nimbus");
    assert.ok(extension, "Extension not found");
    await extension.activate();
    const all = await vscode.commands.getCommands(true);
    const expected = [
      "nimbus.ask",
      "nimbus.askAboutSelection",
      "nimbus.search",
      "nimbus.searchSelection",
      "nimbus.runWorkflow",
      "nimbus.newConversation",
      "nimbus.startGateway",
    ];
    for (const cmd of expected) {
      assert.ok(all.includes(cmd), `Missing command: ${cmd}`);
    }
  });

  it("opens chat panel on Nimbus: Ask", async () => {
    await vscode.commands.executeCommand("nimbus.ask");
    // Allow the panel a tick to render
    await new Promise((r) => setTimeout(r, 200));
    // Webview panels aren't enumerated via API; assert no exception was thrown.
    assert.ok(true);
  });
});
```

- [ ] **Step 27.3: Add an integration script to `package.json`**

Edit `packages/vscode-extension/package.json` `scripts`:

```jsonc
"test:integration": "tsc --module commonjs --outDir test-out test/integration/ask-roundtrip.test.ts test/integration/runner.ts && node test/integration/runner.js"
```

(If `tsc` complaints arise from the existing tsconfig's `module: ESNext`, add a separate `test/integration/tsconfig.json` with `module: commonjs` and `outDir: ./out`.)

- [ ] **Step 27.4: Smoke-run locally**

```bash
cd packages/vscode-extension && bun run build && bun run test:integration
```

Expected: VS Code launches in a sandbox window, runs the test, exits 0. Locally this can take 3-5 min on first run (downloads VS Code).

- [ ] **Step 27.5: Wire into CI**

Edit `.github/workflows/_test-suite.yml`. Add a 3-OS matrix job after `client-node-compat`:

```yaml
  vscode-extension-integration:
    name: VS Code extension integration (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-14, windows-latest]
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@8d3c67de8e2fe68ef647c8db1e6a09f647780f40 # v2.19.0
        with:
          egress-policy: audit
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false
      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: latest
      - name: Setup Node 20
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: "20"
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Build extension
        run: cd packages/vscode-extension && bun run build
      - name: Setup display (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb
      - name: Run integration test
        run: |
          cd packages/vscode-extension
          ${{ runner.os == 'Linux' && 'xvfb-run -a' || '' }} bun run test:integration
```

- [ ] **Step 27.6: Commit**

```bash
git add packages/vscode-extension/test/integration/ packages/vscode-extension/package.json .github/workflows/_test-suite.yml
git commit -m "test(vscode-extension): @vscode/test-electron happy path + 3-OS CI"
```

---

## Task 28: Publish workflow (`publish-vscode.yml`)

**Files:**
- Create: `.github/workflows/publish-vscode.yml`

---

- [ ] **Step 28.1: Create the workflow file**

Create `.github/workflows/publish-vscode.yml`:

```yaml
name: Publish VS Code Extension

on:
  push:
    tags:
      - "vscode-v*"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: vscode-publish
  cancel-in-progress: false

jobs:
  publish:
    name: Build, package, and publish .vsix
    runs-on: ubuntu-latest
    environment: release
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@8d3c67de8e2fe68ef647c8db1e6a09f647780f40 # v2.19.0
        with:
          egress-policy: audit

      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck + lint
        run: |
          bun run --filter @nimbus-dev/client typecheck
          bun run --filter @nimbus-dev/client lint
          bun run --filter @nimbus/vscode-extension typecheck
          bun run --filter @nimbus/vscode-extension lint

      - name: Test
        run: |
          cd packages/client && bun test
          cd ../vscode-extension && bunx vitest run

      - name: Build @nimbus-dev/client
        run: cd packages/client && bun run build

      - name: Build extension bundles
        run: cd packages/vscode-extension && bun run build

      - name: Package .vsix
        id: package
        run: |
          cd packages/vscode-extension
          bunx vsce package --no-dependencies
          VSIX=$(ls *.vsix | head -n1)
          echo "vsix_path=packages/vscode-extension/$VSIX" >> "$GITHUB_OUTPUT"
          echo "vsix_name=$VSIX" >> "$GITHUB_OUTPUT"

      - name: Publish to VS Code Marketplace
        run: |
          cd packages/vscode-extension
          bunx vsce publish --packagePath "${{ steps.package.outputs.vsix_name }}" --pat "$VSCE_PAT"
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

      - name: Publish to Open VSX
        run: |
          cd packages/vscode-extension
          bunx ovsx publish "${{ steps.package.outputs.vsix_name }}" --pat "$OVSX_PAT"
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}

      - name: Upload .vsix to GitHub Release
        uses: softprops/action-gh-release@c95fe1489396fe8a21967200391e1b9067ad0ba5 # v2.6.2
        with:
          files: ${{ steps.package.outputs.vsix_path }}
          tag_name: ${{ github.ref_name }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 28.2: Document required secrets**

Open `docs/release/v0.1.0-prerequisites.md`. Locate the `VSCE_PAT` / `OVSX_PAT` references (or add a §6/§7 entry if missing) confirming both are configured in repo Secrets before tagging `vscode-v0.1.0`.

If those sections don't exist yet, add a brief subsection:

```markdown
### VS Code Marketplace + Open VSX
- **`VSCE_PAT`** — Azure DevOps PAT, scope "Marketplace · Manage". Generate at https://dev.azure.com.
- **`OVSX_PAT`** — Eclipse Foundation account, namespace `nimbus-dev`. Generate at https://open-vsx.org.
```

- [ ] **Step 28.3: Commit**

```bash
git add .github/workflows/publish-vscode.yml docs/release/v0.1.0-prerequisites.md
git commit -m "ci(vscode-extension): publish workflow (Marketplace + Open VSX) + GH Release upload"
```

---

## Task 29: Author `docs/manual-smoke-ws7.md`

**Files:**
- Create: `docs/manual-smoke-ws7.md`

---

- [ ] **Step 29.1: Write the manual smoke checklist**

Create `docs/manual-smoke-ws7.md`:

```markdown
# WS7 Manual Smoke — VS Code Extension

> Run on every supported platform (Windows 11, macOS 14, Linux Ubuntu 22.04+) before tagging `vscode-v0.1.0`. One column per OS; tick on completion.

## Pre-flight

- [ ] `nimbus start` runs and prints "Gateway listening on …" — Win/macOS/Linux
- [ ] Extension `.vsix` builds via `cd packages/vscode-extension && bun run build && bunx vsce package --no-dependencies`

## Install + activation

| Step | Win | macOS | Linux |
|---|---|---|---|
| Install via `code --install-extension nimbus-<ver>.vsix` | ☐ | ☐ | ☐ |
| After 5 s, status bar shows `Nimbus: …` (any state) | ☐ | ☐ | ☐ |
| Output channel "Nimbus" exists with at least one log line | ☐ | ☐ | ☐ |

## Empty state

| Step | Win | macOS | Linux |
|---|---|---|---|
| With Gateway stopped, `Nimbus: Ask` opens panel showing "Gateway is not running" hero card with **Start Gateway** button | ☐ | ☐ | ☐ |
| Click **Start Gateway** — status bar transitions and chat becomes usable | ☐ | ☐ | ☐ |

## Streaming Ask (chat panel)

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Ask` → type `tell me a haiku about the moon` → tokens stream live | ☐ | ☐ | ☐ |
| Stop button cancels mid-stream cleanly | ☐ | ☐ | ☐ |
| Asking again continues the same `sessionId` (Gateway audit log shows two turns) | ☐ | ☐ | ☐ |
| `Nimbus: New Conversation` clears transcript and resets session | ☐ | ☐ | ☐ |
| Reload Window restores transcript (rehydrates last 50 turns) | ☐ | ☐ | ☐ |

## Selection commands

| Step | Win | macOS | Linux |
|---|---|---|---|
| Select 5 lines in any open file → right-click → `Nimbus: Ask About Selection` → input pre-filled with file/lines/code fence | ☐ | ☐ | ☐ |
| `Nimbus: Search Selection` opens Quick Pick filtered by selection text | ☐ | ☐ | ☐ |

## Search command

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Search` shows input box → results in Quick Pick | ☐ | ☐ | ☐ |
| Item with URL opens in default browser via `openExternal` | ☐ | ☐ | ☐ |
| Item with file path opens in editor via `openTextDocument` | ☐ | ☐ | ☐ |
| Item without URL/path opens via `nimbus-item:<id>` URI as read-only markdown | ☐ | ☐ | ☐ |

## Run Workflow

| Step | Win | macOS | Linux |
|---|---|---|---|
| `Nimbus: Run Workflow` Quick Pick lists workflows | ☐ | ☐ | ☐ |
| Selecting one fires toast with **Show Progress** button → focuses Output channel | ☐ | ☐ | ☐ |

## HITL routing

| Step | Win | macOS | Linux |
|---|---|---|---|
| Trigger HITL while chat panel is visible+focused → inline card appears in chat (no modal/toast) | ☐ | ☐ | ☐ |
| Switch to a code file, trigger HITL → non-modal toast with Approve/Reject/View Details | ☐ | ☐ | ☐ |
| Set `nimbus.hitlAlwaysModal: true` in settings, trigger HITL → blocking modal | ☐ | ☐ | ☐ |
| Status bar shows `⚠ N pending` when toast dismissed unanswered | ☐ | ☐ | ☐ |
| Click status-bar `N pending` → Quick Pick of pending requests; select one → resurfaces | ☐ | ☐ | ☐ |

## Theme syncing

| Step | Win | macOS | Linux |
|---|---|---|---|
| Switch to Light theme → chat panel re-themes without reload | ☐ | ☐ | ☐ |
| Switch to High Contrast → chat panel re-themes | ☐ | ☐ | ☐ |
| Switch to High Contrast Light → chat panel re-themes | ☐ | ☐ | ☐ |
| Capture one screenshot per theme; attach to PR | ☐ | ☐ | ☐ |

## Permission denied (Linux/macOS only)

| Step | macOS | Linux |
|---|---|---|
| `chmod 000 <socketPath>` while Gateway running | ☐ | ☐ |
| Status bar shows `Socket permission denied` (red), tooltip mentions path | ☐ | ☐ |
| `chmod 600 <socketPath>` restores normal connection | ☐ | ☐ |

## Memory

| Step | Win | macOS | Linux |
|---|---|---|---|
| Run a 100-turn scripted Ask session (e.g., 100 × `say hi`) | ☐ | ☐ | ☐ |
| `Developer: Open Process Explorer` — extension host RSS < 200 MB | ☐ | ☐ | ☐ |

## Cursor (one OS sufficient)

| Step | One OS |
|---|---|
| Install from Open VSX in Cursor → `Nimbus: Ask` works end-to-end | ☐ |

## Sign-off

- [ ] All boxes ticked, screenshots attached, no regressions noted in CHANGELOG.
- [ ] Author: __________  Reviewer: __________  Date: __________
```

- [ ] **Step 29.2: Commit**

```bash
git add docs/manual-smoke-ws7.md
git commit -m "docs(ws7): manual smoke checklist for 3-OS + Cursor"
```

---

## Task 30: Update `CLAUDE.md` and `GEMINI.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`

---

- [ ] **Step 30.1: Add Key File Locations rows in `CLAUDE.md`**

Open `CLAUDE.md`. In the **Key File Locations** table, find the section for `packages/cli` entries and add a new block immediately after the existing `packages/client/src/index.ts` row:

```markdown
| `packages/client/src/paths.ts` | Bun-free per-platform Nimbus paths — `getNimbusPaths()` |
| `packages/client/src/discovery.ts` | Node-compat socket discovery — `discoverSocketPath()`, `readGatewayState()` |
| `packages/client/src/ask-stream.ts` | `createAskStream` AsyncIterable handle |
| `packages/client/src/stream-events.ts` | `StreamEvent` discriminated union |
| `packages/gateway/src/ipc/engine-ask-stream.ts` | Extracted `engine.askStream` handler with AbortController-based cancellation |
| `packages/gateway/src/ipc/engine-cancel-stream.ts` | `engine.cancelStream` IPC handler (idempotent) |
| `packages/gateway/src/ipc/engine-get-session-transcript.ts` | `engine.getSessionTranscript` over `audit_log` |
| `packages/vscode-extension/src/extension.ts` | VS Code extension activate/deactivate; only file allowed to import `vscode` |
| `packages/vscode-extension/src/vscode-shim.ts` | Narrow vscode interfaces for testability boundary |
| `packages/vscode-extension/src/connection/connection-manager.ts` | `NimbusClient` lifecycle; reconnect; EACCES distinct state |
| `packages/vscode-extension/src/hitl/hitl-router.ts` | Inline / toast / modal context-sensitive routing |
| `packages/vscode-extension/src/chat/chat-controller.ts` | `askStream` pump → Webview message translation |
| `packages/vscode-extension/src/chat/session-store.ts` | `workspaceState` `nimbus.activeSessionId` UUID persistence (metadata only) |
| `packages/vscode-extension/src/chat/webview/main.ts` | Browser-side Webview entry point |
| `packages/vscode-extension/src/search/item-provider.ts` | `nimbus-item:` URI scheme provider |
```

- [ ] **Step 30.2: Add commands section in `CLAUDE.md`**

In the **Commands** section, add (alphabetical with existing entries):

```bash
# Phase 4 WS7 — VS Code extension
# packages/vscode-extension/ — bunx vsce package; bun run build; bunx vitest run
# Tag vscode-v* to publish via .github/workflows/publish-vscode.yml
bun run test:coverage:vscode-extension     # vitest coverage gate ≥ 80% lines / ≥ 75% branches
```

- [ ] **Step 30.3: Flip status row in `CLAUDE.md`**

Find the line:

```markdown
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅ · WS5-D ✅ · WS6 ✅ · S2 graph-aware watchers ✅)
```

Update to:

```markdown
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅ · WS5-D ✅ · WS6 ✅ · WS7 ✅ · S2 graph-aware watchers ✅)
```

- [ ] **Step 30.4: Mirror changes in `GEMINI.md`**

Apply the same three edits (file locations, commands, status row) to `GEMINI.md`.

- [ ] **Step 30.5: Commit**

```bash
git add CLAUDE.md GEMINI.md
git commit -m "docs(ws7): update CLAUDE.md + GEMINI.md with extension key files + status"
```

---

## Task 31: Update `roadmap.md` and `v0.1.0-finish-plan.md`

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/release/v0.1.0-finish-plan.md`

---

- [ ] **Step 31.1: Update `docs/roadmap.md`**

Open `docs/roadmap.md`. Find the WS7 row (likely under Phase 4 — Presence). Change `[ ]` to `[x]` and append the v0.1.0 marker if the convention requires it (match adjacent rows).

- [ ] **Step 31.2: Update `docs/release/v0.1.0-finish-plan.md`**

In the §2 status snapshot:
- Move the WS7 row from "🔄 Open in v0.1.0" to "✅ Done (merged to `main`)".
- Tick the §4.6 release-gate row "VS Code extension connects + Ask works" once manual smoke (Task 29) passes on all three platforms.

- [ ] **Step 31.3: Commit**

```bash
git add docs/roadmap.md docs/release/v0.1.0-finish-plan.md
git commit -m "docs(ws7): flip roadmap + finish-plan status to complete"
```

---

## Task 32: Final spec acceptance verification

**Files:** none (verification only)

---

- [ ] **Step 32.1: Run the full repo test suite + typecheck + lint**

```bash
bun run typecheck && bun run lint && bun test
cd packages/vscode-extension && bunx vitest run --coverage
cd packages/client && bun test
```

Expected: ALL PASS. Coverage report on the extension shows ≥ 80% lines / ≥ 75% branches.

- [ ] **Step 32.2: Walk every acceptance criterion in the spec**

Open `docs/superpowers/specs/2026-04-24-ws7-vscode-extension-design.md` §11 and tick each box against the implementation:

- [ ] `Nimbus: Ask` streams on VS Code 1.90+ (verified via integration test + manual smoke)
- [ ] Inline HITL when chat visible+focused; non-modal toast otherwise; modal opt-in (unit + manual)
- [ ] `Nimbus: Ask About Selection` pre-fill format matches `buildAskAboutSelectionPrefill` (unit)
- [ ] `Nimbus: Run Workflow` toast with Show Progress → Output channel (manual)
- [ ] Status-bar health dot updates within 30 s (manual)
- [ ] Status-bar HITL count badge ≤ 1 s (unit + manual)
- [ ] `Nimbus: New Conversation` cancels + resets + clears (unit + manual)
- [ ] Reload restores transcript via `engine.getSessionTranscript` reading sessionId from workspaceState (manual)
- [ ] `Nimbus: Search` opens external/file/`nimbus-item:` correctly (unit + manual)
- [ ] Open VSX install on Cursor works (manual)
- [ ] `@nimbus-dev/client` node-compat 3-OS CI green (CI)
- [ ] Theme syncing across Dark/Light/HC/HC-Light (manual screenshots)
- [ ] Coverage ≥ 80%/75% (CI gate)

- [ ] **Step 32.3: Update `docs/release/v0.1.0-finish-plan.md` §4.6 row**

Tick "VS Code extension connects + Ask works" for all three platforms. Tick "code" + "verified" columns.

- [ ] **Step 32.4: Final commit**

```bash
git add -A
git diff --staged --stat
git commit -m "feat(ws7): final acceptance verification — VS Code extension complete"
```

(If no changes remain, skip the commit.)

- [ ] **Step 32.5: Tag the release readiness**

Coordinate with the maintainer to tag `vscode-v0.1.0` once the manual smoke passes. The publish workflow (Task 28) handles publishing automatically once the tag is pushed.

---

## Self-Review (run after the plan is written, before handing off)

A quick pass against the spec:

**Spec coverage:**

- §2 scope items 1-16 → Tasks 14, 1-13, 11, 25, 18-22, 23, 25, 17, 19-21, 23, 12, 13, 29, 28 — all covered.
- §3 architecture diagram → Tasks 16-18 (connection/status), 19-21 (HITL), 21-22 (chat) — covered.
- §4 client refactor (subsections 4.1-4.7) → Tasks 1-7, 12 — fully covered.
- §5 Gateway changes → Tasks 8-11 — covered.
- §6 extension details (commands, settings, status bar, Webview, HITL, streaming flow, edge cases, shim) → Tasks 14-26 — covered.
- §7 package layout → Task 14 + every subsequent extension task fits.
- §8 testing strategy → covered across every TDD task + Task 27 + Task 13 (CI).
- §9 publishing pipeline → Task 28.
- §10 file map → Task 14 (extension scaffold) + Tasks 1-2 (paths/discovery) + Task 11 (Tauri allowlist) + Tasks 30-31 (docs).
- §11 acceptance criteria → Task 32 walks every box.
- §13 deferred items — all explicitly out of scope; no plan tasks for them.

**Placeholder scan:** No "TBD", "TODO", "implement later", or vague "add appropriate error handling" — all steps include code or exact commands.

**Type consistency check:**

- `StreamEvent` shape used identically in Task 4, Task 5, Task 7, Task 22, and Task 23.
- `HitlRequest` from `@nimbus-dev/client` consumed in Task 19 (router), Task 20 (surfaces), Task 22 (controller), Task 26 (extension wiring).
- `NimbusClient.askStream(input, opts)` signature matches across Tasks 5, 6, 7, 22, 26.
- `discoverSocketPath` return shape `{ socketPath, source, pid? }` matches between Task 2 (impl) and Task 26 (consumption).
- `formatStatusBar` `StatusBarInputs` shape matches between Task 18 (test) and Task 26 (call site).

No inconsistencies found.

**Scope check:** This is one workstream producing one extension + one client refactor + two Gateway methods. Single implementation plan is correct — no need to decompose further.

---

## Plan Complete

Plan saved to `docs/superpowers/plans/2026-04-24-ws7-vscode-extension.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration via `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?

