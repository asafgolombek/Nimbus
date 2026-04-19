# WS5-C Gateway IPC Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Gateway-side JSON-RPC surface that WS5-C's Settings panels consume, so the follow-up UI plan can ship as pure UI work with no Gateway edits.

**Architecture:** Additive only. New methods land in existing `packages/gateway/src/ipc/*-rpc.ts` dispatchers or in new ones, all registered through `server.ts`. Subsystem logic (`LlmRegistry`, new `ProfileManager`, telemetry collector, connector manager) is extended with the minimum helpers each method needs. Every new method is covered by an RPC-level test before the handler is written (TDD). No change breaks existing methods or CLI paths.

**Tech Stack:** Bun v1.2+ · TypeScript 6.x strict · `bun:test` · Biome. No new runtime dependency is added.

**Parent spec:** [`docs/superpowers/specs/2026-04-19-ws5c-settings-design.md`](../specs/2026-04-19-ws5c-settings-design.md)

**Branching strategy:** One feature branch `dev/asafgolombek/ws5c-gateway-ipc` off `dev/asafgolombek/phase_4_ws5`. Each phase becomes a commit chain; final PR targets the umbrella branch.

---

## Pre-flight (do once before Task 1)

- [ ] **Step A — Create feature branch**

```bash
git checkout -b dev/asafgolombek/ws5c-gateway-ipc dev/asafgolombek/phase_4_ws5
```

- [ ] **Step B — Confirm baseline green**

```bash
bun run typecheck && bun test --bail
```

Expected: all existing tests pass. If anything is already red on `dev/asafgolombek/phase_4_ws5`, stop and fix the pre-existing failure before continuing.

- [ ] **Step C — Read the existing IPC dispatch pattern**

Read `packages/gateway/src/ipc/server.ts` around the `dispatchMethod` switch (line ~860) and `packages/gateway/src/ipc/llm-rpc.ts`. Every new handler in this plan follows the same `{ kind: "hit"; value: unknown } | { kind: "miss" }` shape.

---

## Phase 1 — LLM control surface

Adds the model-lifecycle methods that the Settings → Model panel needs: pull with progress streaming, load/unload stubs, default selection persisted per task type, router-decision introspection, pull cancellation.

### Task 1: `OllamaProvider.pullModel` (streaming)

**Files:**
- Modify: `packages/gateway/src/llm/ollama-provider.ts`
- Modify: `packages/gateway/src/llm/types.ts`
- Test: `packages/gateway/src/llm/ollama-provider.test.ts`

- [ ] **Step 1: Extend `LlmProvider` type with an optional `pullModel` method**

In `packages/gateway/src/llm/types.ts`, add to the `LlmProvider` interface:

```ts
pullModel?(
  modelName: string,
  opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void },
): Promise<void>;
```

And export:

```ts
export type PullProgressChunk = {
  status: string;
  completedBytes?: number;
  totalBytes?: number;
};
```

- [ ] **Step 2: Write the failing test**

Add to `packages/gateway/src/llm/ollama-provider.test.ts`:

```ts
test("pullModel streams progress chunks and resolves on done", async () => {
  const chunks = [
    '{"status":"pulling manifest"}\n',
    '{"status":"downloading","completed":100,"total":1000}\n',
    '{"status":"downloading","completed":1000,"total":1000}\n',
    '{"status":"success"}\n',
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/api/pull") return new Response(null, { status: 404 });
      const body = new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    },
  });
  const p = new OllamaProvider(`http://127.0.0.1:${server.port}`);
  const received: PullProgressChunk[] = [];
  await p.pullModel!("llama3.2:1b", { onProgress: (c) => received.push(c) });
  server.stop();
  expect(received.at(-1)?.status).toBe("success");
  expect(received.some((c) => c.completedBytes === 1000)).toBe(true);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/llm/ollama-provider.test.ts -t "pullModel streams progress"
```

Expected: FAIL — `pullModel is not a function`.

- [ ] **Step 4: Implement `pullModel` in `OllamaProvider`**

Append to the class in `packages/gateway/src/llm/ollama-provider.ts`:

```ts
async pullModel(
  modelName: string,
  opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void } = {},
): Promise<void> {
  const resp = await fetch(`${this.baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelName, stream: true }),
    signal: opts.signal,
  });
  if (!resp.ok) throw new Error(`Ollama pullModel HTTP ${resp.status}`);
  const reader = resp.body?.getReader();
  if (reader === undefined) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const chunk = JSON.parse(trimmed) as { status?: unknown; completed?: unknown; total?: unknown };
        const progress: PullProgressChunk = {
          status: typeof chunk.status === "string" ? chunk.status : "",
          ...(typeof chunk.completed === "number" && { completedBytes: chunk.completed }),
          ...(typeof chunk.total === "number" && { totalBytes: chunk.total }),
        };
        opts.onProgress?.(progress);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
```

Add `import type { PullProgressChunk } from "./types.ts";` at the top if not already importing from `./types`.

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/llm/ollama-provider.test.ts -t "pullModel streams progress"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/llm/types.ts packages/gateway/src/llm/ollama-provider.ts packages/gateway/src/llm/ollama-provider.test.ts
git commit -m "feat(llm): OllamaProvider.pullModel streams NDJSON progress chunks"
```

### Task 2: `LlmRegistry.pullModel` + `llm.pullModel` RPC with progress notifications

**Files:**
- Modify: `packages/gateway/src/llm/registry.ts`
- Modify: `packages/gateway/src/ipc/llm-rpc.ts`
- Modify: `packages/gateway/src/ipc/server.ts`
- Test: `packages/gateway/src/ipc/llm-rpc.test.ts`

- [ ] **Step 1: Write the failing RPC test**

Add to `packages/gateway/src/ipc/llm-rpc.test.ts` (create with the existing-test scaffolding if empty):

```ts
import { describe, test, expect, mock } from "bun:test";
import { dispatchLlmRpc } from "./llm-rpc.ts";
import type { LlmRegistry } from "../llm/registry.ts";

describe("llm.pullModel", () => {
  test("returns { pullId } and calls registry.pullModel", async () => {
    const pullModel = mock(async () => {});
    const registry = { pullModel } as unknown as LlmRegistry;
    const notify = mock((_m: string, _p: unknown) => {});
    const result = await dispatchLlmRpc(
      "llm.pullModel",
      { provider: "ollama", modelName: "gemma:2b" },
      { registry, notify },
    );
    expect(result.kind).toBe("hit");
    expect((result as { value: { pullId: string } }).value.pullId).toMatch(/^pull_/);
    expect(pullModel).toHaveBeenCalledTimes(1);
  });

  test("rejects unknown provider with -32602", async () => {
    const registry = { pullModel: mock(async () => {}) } as unknown as LlmRegistry;
    await expect(
      dispatchLlmRpc("llm.pullModel", { provider: "remote", modelName: "x" }, { registry, notify: () => {} }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "llm.pullModel"
```

Expected: FAIL — `dispatchLlmRpc` returns miss; context shape mismatch.

- [ ] **Step 3: Extend `LlmRegistry` with `pullModel`**

Append to the `LlmRegistry` class in `packages/gateway/src/llm/registry.ts`:

```ts
async pullModel(
  provider: "ollama" | "llamacpp",
  modelName: string,
  opts: { signal?: AbortSignal; onProgress?: (p: PullProgressChunk) => void } = {},
): Promise<void> {
  const p = (
    this.router as unknown as { providers: Map<string, LlmProvider> }
  ).providers?.get(provider);
  if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
  if (typeof p.pullModel !== "function") {
    throw new Error(`Provider ${provider} does not support pullModel`);
  }
  await p.pullModel(modelName, opts);
}
```

Add `import type { PullProgressChunk } from "./types.ts";` at the top.

- [ ] **Step 4: Extend the RPC dispatcher**

Replace the body of `dispatchLlmRpc` in `packages/gateway/src/ipc/llm-rpc.ts` with:

```ts
export type LlmRpcContext = {
  registry: LlmRegistry;
  notify: (method: string, params: unknown) => void;
};

const activePulls = new Map<string, AbortController>();

export async function dispatchLlmRpc(
  method: string,
  params: unknown,
  ctx: LlmRpcContext,
): Promise<{ kind: "hit"; value: unknown } | { kind: "miss" }> {
  switch (method) {
    case "llm.listModels": {
      const models = await ctx.registry.listAllModels();
      return { kind: "hit", value: { models } };
    }
    case "llm.getStatus": {
      const available = await ctx.registry.checkAvailability();
      return { kind: "hit", value: { available } };
    }
    case "llm.pullModel": {
      const p = params as { provider?: string; modelName?: string } | null;
      if (p === null || typeof p.modelName !== "string") {
        throw new LlmRpcError(-32602, "pullModel requires modelName");
      }
      const provider = p.provider ?? "ollama";
      if (provider !== "ollama" && provider !== "llamacpp") {
        throw new LlmRpcError(-32602, `Unsupported provider: ${provider}`);
      }
      const pullId = `pull_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      activePulls.set(pullId, controller);
      void ctx.registry
        .pullModel(provider, p.modelName, {
          signal: controller.signal,
          onProgress: (c) =>
            ctx.notify("llm.pullProgress", { pullId, provider, modelName: p.modelName, ...c }),
        })
        .then(() => ctx.notify("llm.pullCompleted", { pullId, provider, modelName: p.modelName }))
        .catch((err: unknown) =>
          ctx.notify("llm.pullFailed", {
            pullId,
            provider,
            modelName: p.modelName,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        .finally(() => activePulls.delete(pullId));
      return { kind: "hit", value: { pullId } };
    }
    case "llm.cancelPull": {
      const p = params as { pullId?: string } | null;
      if (p === null || typeof p.pullId !== "string") {
        throw new LlmRpcError(-32602, "cancelPull requires pullId");
      }
      const controller = activePulls.get(p.pullId);
      const cancelled = controller !== undefined;
      controller?.abort();
      return { kind: "hit", value: { cancelled } };
    }
    default:
      return { kind: "miss" };
  }
}
```

- [ ] **Step 5: Wire the new context shape in `server.ts`**

In `packages/gateway/src/ipc/server.ts`, locate where `dispatchLlmRpc` is called and pass the notifier:

```ts
const llmResult = await dispatchLlmRpc(method, params, {
  registry: opts.llmRegistry,
  notify: (m, p) => sendNotification(m, p),
});
```

(`sendNotification` is the existing notification emitter used by other RPCs in the same file — verify the name and match it.)

- [ ] **Step 6: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "llm.pullModel"
```

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/llm/registry.ts packages/gateway/src/ipc/llm-rpc.ts packages/gateway/src/ipc/llm-rpc.test.ts packages/gateway/src/ipc/server.ts
git commit -m "feat(ipc): llm.pullModel with pullProgress/pullCompleted/pullFailed notifications + llm.cancelPull"
```

### Task 3: `llm.loadModel` / `llm.unloadModel`

**Files:**
- Modify: `packages/gateway/src/llm/registry.ts`
- Modify: `packages/gateway/src/ipc/llm-rpc.ts`
- Test: `packages/gateway/src/ipc/llm-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/gateway/src/ipc/llm-rpc.test.ts`:

```ts
describe("llm.loadModel / llm.unloadModel", () => {
  test("loadModel marks the model as loaded and returns isLoaded: true", async () => {
    const loadModel = mock(async () => {});
    const registry = { loadModel } as unknown as LlmRegistry;
    const r = await dispatchLlmRpc(
      "llm.loadModel",
      { provider: "ollama", modelName: "gemma:2b" },
      { registry, notify: () => {} },
    );
    expect(r.kind).toBe("hit");
    expect((r as { value: { isLoaded: boolean } }).value.isLoaded).toBe(true);
    expect(loadModel).toHaveBeenCalledWith("ollama", "gemma:2b");
  });

  test("unloadModel returns isLoaded: false", async () => {
    const unloadModel = mock(async () => {});
    const registry = { unloadModel } as unknown as LlmRegistry;
    const r = await dispatchLlmRpc(
      "llm.unloadModel",
      { provider: "ollama", modelName: "gemma:2b" },
      { registry, notify: () => {} },
    );
    expect((r as { value: { isLoaded: boolean } }).value.isLoaded).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "loadModel"
```

- [ ] **Step 3: Extend `LlmRegistry`**

Append to `LlmRegistry`:

```ts
async loadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<void> {
  const p = (
    this.router as unknown as { providers: Map<string, LlmProvider> }
  ).providers?.get(provider);
  if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
  if (typeof (p as unknown as { loadModel?: unknown }).loadModel === "function") {
    await (p as unknown as { loadModel: (m: string) => Promise<void> }).loadModel(modelName);
  }
  // Ollama auto-loads on first generate; this is a no-op for Ollama.
}

async unloadModel(provider: "ollama" | "llamacpp", modelName: string): Promise<void> {
  const p = (
    this.router as unknown as { providers: Map<string, LlmProvider> }
  ).providers?.get(provider);
  if (p === undefined) throw new Error(`Provider not registered: ${provider}`);
  if (typeof (p as unknown as { unloadModel?: unknown }).unloadModel === "function") {
    await (p as unknown as { unloadModel: (m: string) => Promise<void> }).unloadModel(modelName);
  }
}
```

- [ ] **Step 4: Add the two RPC cases**

In `dispatchLlmRpc`, before the `default`:

```ts
case "llm.loadModel": {
  const p = params as { provider?: string; modelName?: string } | null;
  if (p === null || typeof p.modelName !== "string") {
    throw new LlmRpcError(-32602, "loadModel requires modelName");
  }
  const provider = p.provider ?? "ollama";
  if (provider !== "ollama" && provider !== "llamacpp") {
    throw new LlmRpcError(-32602, `Unsupported provider: ${provider}`);
  }
  await ctx.registry.loadModel(provider, p.modelName);
  ctx.notify("llm.modelLoaded", { provider, modelName: p.modelName });
  return { kind: "hit", value: { isLoaded: true } };
}
case "llm.unloadModel": {
  const p = params as { provider?: string; modelName?: string } | null;
  if (p === null || typeof p.modelName !== "string") {
    throw new LlmRpcError(-32602, "unloadModel requires modelName");
  }
  const provider = p.provider ?? "ollama";
  if (provider !== "ollama" && provider !== "llamacpp") {
    throw new LlmRpcError(-32602, `Unsupported provider: ${provider}`);
  }
  await ctx.registry.unloadModel(provider, p.modelName);
  ctx.notify("llm.modelUnloaded", { provider, modelName: p.modelName });
  return { kind: "hit", value: { isLoaded: false } };
}
```

- [ ] **Step 5: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "loadModel"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/llm/registry.ts packages/gateway/src/ipc/llm-rpc.ts packages/gateway/src/ipc/llm-rpc.test.ts
git commit -m "feat(ipc): llm.loadModel / llm.unloadModel with modelLoaded/modelUnloaded notifications"
```

### Task 4: `llm.setDefault` + persistence

**Files:**
- Modify: `packages/gateway/src/llm/registry.ts`
- Modify: `packages/gateway/src/ipc/llm-rpc.ts`
- Test: `packages/gateway/src/ipc/llm-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `llm-rpc.test.ts`:

```ts
describe("llm.setDefault", () => {
  test("persists default per task type and echoes back", async () => {
    const setDefault = mock(async () => {});
    const registry = { setDefault } as unknown as LlmRegistry;
    const r = await dispatchLlmRpc(
      "llm.setDefault",
      { taskType: "classification", provider: "ollama", modelName: "gemma:2b" },
      { registry, notify: () => {} },
    );
    expect(r.kind).toBe("hit");
    expect((r as { value: { taskType: string } }).value.taskType).toBe("classification");
    expect(setDefault).toHaveBeenCalledWith("classification", "ollama", "gemma:2b");
  });

  test("rejects invalid taskType", async () => {
    const registry = { setDefault: mock(async () => {}) } as unknown as LlmRegistry;
    await expect(
      dispatchLlmRpc(
        "llm.setDefault",
        { taskType: "bogus", provider: "ollama", modelName: "x" },
        { registry, notify: () => {} },
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "setDefault"
```

- [ ] **Step 3: Extend `LlmRegistry`**

Append:

```ts
async setDefault(
  taskType: "classification" | "embedding" | "reasoning" | "generation",
  provider: "ollama" | "llamacpp" | "remote",
  modelName: string,
): Promise<void> {
  if (this.db === undefined) return;
  this.db.run(
    `INSERT INTO llm_task_defaults (task_type, provider, model_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_type) DO UPDATE SET
       provider = excluded.provider,
       model_name = excluded.model_name,
       updated_at = excluded.updated_at`,
    [taskType, provider, modelName, Date.now()],
  );
}

getDefault(taskType: string): { provider: string; modelName: string } | undefined {
  if (this.db === undefined) return undefined;
  const row = this.db
    .query("SELECT provider, model_name FROM llm_task_defaults WHERE task_type = ?")
    .get(taskType) as { provider: string; model_name: string } | undefined;
  return row === undefined ? undefined : { provider: row.provider, modelName: row.model_name };
}
```

- [ ] **Step 4: Add a migration for `llm_task_defaults`**

Locate the last migration number in `packages/gateway/src/index/` (continuing from V17 per CLAUDE.md). Create `packages/gateway/src/index/llm-task-defaults-v18-sql.ts`:

```ts
export const LLM_TASK_DEFAULTS_V18_SQL = `
CREATE TABLE IF NOT EXISTS llm_task_defaults (
  task_type TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
```

Register it in the migrations list (follow the pattern used for V17 — find `SUB_TASK_RESULTS_V17_SQL` import and its registration; add the new one immediately after).

> **Note on numbering.** WS3 reserves V18 for `audit_log.row_hash/prev_hash` per CLAUDE.md. If WS3 has already consumed V18, use V19 here and shift the V19 `lan_peers` migration accordingly — verify migration numbers are in order before committing.

- [ ] **Step 5: Add the RPC case**

Before the `default` in `dispatchLlmRpc`:

```ts
case "llm.setDefault": {
  const VALID_TASKS = new Set(["classification", "embedding", "reasoning", "generation"]);
  const VALID_PROVIDERS = new Set(["ollama", "llamacpp", "remote"]);
  const p = params as { taskType?: string; provider?: string; modelName?: string } | null;
  if (
    p === null ||
    typeof p.taskType !== "string" || !VALID_TASKS.has(p.taskType) ||
    typeof p.provider !== "string" || !VALID_PROVIDERS.has(p.provider) ||
    typeof p.modelName !== "string"
  ) {
    throw new LlmRpcError(-32602, "setDefault requires valid taskType, provider, modelName");
  }
  await ctx.registry.setDefault(
    p.taskType as "classification" | "embedding" | "reasoning" | "generation",
    p.provider as "ollama" | "llamacpp" | "remote",
    p.modelName,
  );
  return { kind: "hit", value: { taskType: p.taskType, provider: p.provider, modelName: p.modelName } };
}
```

- [ ] **Step 6: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "setDefault"
```

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/llm/registry.ts packages/gateway/src/ipc/llm-rpc.ts packages/gateway/src/ipc/llm-rpc.test.ts packages/gateway/src/index/llm-task-defaults-v18-sql.ts
git commit -m "feat(ipc): llm.setDefault persists task-type defaults (V18 schema: llm_task_defaults)"
```

### Task 5: `llm.getRouterStatus`

**Files:**
- Modify: `packages/gateway/src/llm/router.ts`
- Modify: `packages/gateway/src/llm/registry.ts`
- Modify: `packages/gateway/src/ipc/llm-rpc.ts`
- Test: `packages/gateway/src/ipc/llm-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("llm.getRouterStatus", () => {
  test("returns a routing decision per task type", async () => {
    const getRouterStatus = mock(async () => ({
      classification: { providerId: "ollama", modelName: "gemma:2b", reason: "default" },
      embedding: { providerId: "ollama", modelName: "nomic-embed", reason: "default" },
      reasoning: { providerId: "remote", modelName: "claude", reason: "air-gap off" },
      generation: { providerId: "ollama", modelName: "llama3.2", reason: "default" },
    }));
    const registry = { getRouterStatus } as unknown as LlmRegistry;
    const r = await dispatchLlmRpc("llm.getRouterStatus", null, { registry, notify: () => {} });
    expect(r.kind).toBe("hit");
    const decisions = (r as { value: Record<string, unknown> }).value;
    expect(Object.keys(decisions).sort()).toEqual(
      ["classification", "embedding", "generation", "reasoning"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "getRouterStatus"
```

- [ ] **Step 3: Add `getStatus` to `LlmRouter`**

Append to `LlmRouter` in `packages/gateway/src/llm/router.ts`:

```ts
async getStatus(): Promise<
  Record<LlmTaskType, { providerId: string; modelName: string; reason: string } | undefined>
> {
  const tasks: LlmTaskType[] = ["classification", "embedding", "reasoning", "generation"];
  const out: Record<string, { providerId: string; modelName: string; reason: string } | undefined> = {};
  for (const t of tasks) {
    const provider = await this.selectProvider(t);
    if (provider === undefined) {
      out[t] = undefined;
      continue;
    }
    const reason = this.config.enforceAirGap && provider.providerId === "remote"
      ? "air-gap bypassed"
      : "default";
    out[t] = { providerId: provider.providerId, modelName: "", reason };
  }
  return out as Record<LlmTaskType, { providerId: string; modelName: string; reason: string } | undefined>;
}
```

> Note: `modelName` is provider-specific and not always exposed via `LlmProvider` today. Leave empty string until a follow-up task threads it through; the Settings panel will render the provider id and fall back to "(default model)" when `modelName` is empty.

- [ ] **Step 4: Expose from `LlmRegistry`**

Append to `LlmRegistry`:

```ts
async getRouterStatus(): Promise<Awaited<ReturnType<LlmRouter["getStatus"]>>> {
  return await this.router.getStatus();
}
```

- [ ] **Step 5: Add the RPC case**

```ts
case "llm.getRouterStatus": {
  const decisions = await ctx.registry.getRouterStatus();
  return { kind: "hit", value: { decisions } };
}
```

- [ ] **Step 6: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/llm-rpc.test.ts -t "getRouterStatus"
```

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/llm/router.ts packages/gateway/src/llm/registry.ts packages/gateway/src/ipc/llm-rpc.ts packages/gateway/src/ipc/llm-rpc.test.ts
git commit -m "feat(ipc): llm.getRouterStatus returns per-task-type routing decisions"
```

---

## Phase 2 — Profiles subsystem

CLAUDE.md lists `packages/gateway/src/config/profiles.ts`, but it is not present in the current tree. CLI commands exist under `packages/cli/src/commands/profile.ts` — inspect them first and reuse any helper they delegate to; if they embed profile logic directly, extract it into the new `ProfileManager`. The four IPC methods below all delegate to that class.

### Task 6: `ProfileManager` class

**Files:**
- Create: `packages/gateway/src/config/profiles.ts`
- Create: `packages/gateway/src/config/profiles.test.ts`
- Read first: `packages/cli/src/commands/profile.ts`

- [ ] **Step 1: Read the existing CLI profile logic**

Skim `packages/cli/src/commands/profile.ts` to understand: where profile state lives on disk, what file format is used, and how vault key prefixing is computed. The new `ProfileManager` must not diverge from the CLI's behavior.

- [ ] **Step 2: Write the failing test**

Create `packages/gateway/src/config/profiles.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileManager } from "./profiles.ts";

describe("ProfileManager", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nimbus-profiles-"));
  });

  test("list returns empty array before any profile is created", async () => {
    const mgr = new ProfileManager(dir);
    expect(await mgr.list()).toEqual([]);
    expect(await mgr.getActive()).toBeUndefined();
  });

  test("create + switch + list round trip", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.create("personal");
    await mgr.switchTo("personal");
    const profiles = await mgr.list();
    expect(profiles.map((p) => p.name).sort()).toEqual(["personal", "work"]);
    expect(profiles.find((p) => p.active)?.name).toBe("personal");
  });

  test("delete refuses the active profile", async () => {
    const mgr = new ProfileManager(dir);
    await mgr.create("work");
    await mgr.switchTo("work");
    await expect(mgr.delete("work")).rejects.toThrow(/active/i);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/config/profiles.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `ProfileManager`**

Create `packages/gateway/src/config/profiles.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export type ProfileSummary = { name: string; active: boolean; createdAt: number };

type ProfileFile = { profiles: { name: string; createdAt: number }[]; active: string | null };

export class ProfileManager {
  private readonly root: string;
  private readonly file: string;

  constructor(rootDir: string) {
    this.root = rootDir;
    this.file = join(rootDir, "profiles.json");
    if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true });
  }

  private read(): ProfileFile {
    if (!existsSync(this.file)) return { profiles: [], active: null };
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as ProfileFile;
    } catch {
      return { profiles: [], active: null };
    }
  }

  private write(f: ProfileFile): void {
    writeFileSync(this.file, JSON.stringify(f, null, 2), "utf8");
  }

  async list(): Promise<ProfileSummary[]> {
    const f = this.read();
    return f.profiles.map((p) => ({ name: p.name, active: f.active === p.name, createdAt: p.createdAt }));
  }

  async getActive(): Promise<string | undefined> {
    return this.read().active ?? undefined;
  }

  async create(name: string): Promise<void> {
    if (!/^[a-z0-9_-]{1,32}$/i.test(name)) throw new Error("Invalid profile name");
    const f = this.read();
    if (f.profiles.some((p) => p.name === name)) throw new Error(`Profile already exists: ${name}`);
    f.profiles.push({ name, createdAt: Date.now() });
    const profileDir = join(this.root, name);
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
    this.write(f);
  }

  async switchTo(name: string): Promise<void> {
    const f = this.read();
    if (!f.profiles.some((p) => p.name === name)) throw new Error(`Profile not found: ${name}`);
    f.active = name;
    this.write(f);
  }

  async delete(name: string): Promise<void> {
    const f = this.read();
    if (f.active === name) throw new Error(`Cannot delete active profile: ${name}`);
    f.profiles = f.profiles.filter((p) => p.name !== name);
    this.write(f);
    const profileDir = join(this.root, name);
    if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
  }

  vaultKeyPrefix(): string {
    const active = this.read().active;
    return active === null ? "" : `profile/${active}/`;
  }
}
```

- [ ] **Step 5: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/config/profiles.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/config/profiles.ts packages/gateway/src/config/profiles.test.ts
git commit -m "feat(config): ProfileManager backed by profiles.json with active-profile invariant"
```

### Task 7: `profile.list` + `profile.getActive`

**Files:**
- Create: `packages/gateway/src/ipc/profile-rpc.ts`
- Create: `packages/gateway/src/ipc/profile-rpc.test.ts`
- Modify: `packages/gateway/src/ipc/server.ts`

- [ ] **Step 1: Write the failing RPC test**

Create `packages/gateway/src/ipc/profile-rpc.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchProfileRpc } from "./profile-rpc.ts";
import { ProfileManager } from "../config/profiles.ts";

describe("profile.list", () => {
  let mgr: ProfileManager;
  beforeEach(() => {
    mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
  });

  test("returns empty list + active=null before any create", async () => {
    const r = await dispatchProfileRpc("profile.list", null, { manager: mgr });
    expect(r.kind).toBe("hit");
    expect((r as { value: { profiles: unknown[]; active: string | null } }).value).toEqual({
      profiles: [],
      active: null,
    });
  });

  test("returns created profiles + current active", async () => {
    await mgr.create("work");
    await mgr.switchTo("work");
    const r = await dispatchProfileRpc("profile.list", null, { manager: mgr });
    const v = (r as { value: { profiles: { name: string }[]; active: string | null } }).value;
    expect(v.profiles.map((p) => p.name)).toEqual(["work"]);
    expect(v.active).toBe("work");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts
```

- [ ] **Step 3: Create the dispatcher**

Create `packages/gateway/src/ipc/profile-rpc.ts`:

```ts
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
    default:
      return { kind: "miss" };
  }
}
```

- [ ] **Step 4: Register in `server.ts`**

In `packages/gateway/src/ipc/server.ts`, import and dispatch (follow the existing `dispatchLlmRpc` wiring pattern):

```ts
import { dispatchProfileRpc } from "./profile-rpc.ts";
// ...
const profileResult = await dispatchProfileRpc(method, params, {
  manager: opts.profileManager,
  notify: (m, p) => sendNotification(m, p),
});
if (profileResult.kind === "hit") return profileResult.value;
```

Extend `opts` (the server startup options type) with `profileManager: ProfileManager` and wire it up at Gateway boot where the other managers are created.

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/profile-rpc.ts packages/gateway/src/ipc/profile-rpc.test.ts packages/gateway/src/ipc/server.ts
git commit -m "feat(ipc): profile.list returns profiles + active"
```

### Task 8: `profile.create`

**Files:**
- Modify: `packages/gateway/src/ipc/profile-rpc.ts`
- Modify: `packages/gateway/src/ipc/profile-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `profile-rpc.test.ts`:

```ts
describe("profile.create", () => {
  let mgr: ProfileManager;
  beforeEach(() => {
    mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
  });

  test("creates a new profile and returns it", async () => {
    const r = await dispatchProfileRpc("profile.create", { name: "work" }, { manager: mgr });
    expect(r.kind).toBe("hit");
    const profiles = await mgr.list();
    expect(profiles.map((p) => p.name)).toEqual(["work"]);
  });

  test("rejects duplicate names", async () => {
    await mgr.create("work");
    await expect(
      dispatchProfileRpc("profile.create", { name: "work" }, { manager: mgr }),
    ).rejects.toThrow();
  });

  test("rejects invalid names", async () => {
    await expect(
      dispatchProfileRpc("profile.create", { name: "bad name!" }, { manager: mgr }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.create"
```

- [ ] **Step 3: Add the case**

Before the `default` in `dispatchProfileRpc`:

```ts
case "profile.create": {
  const p = params as { name?: unknown } | null;
  if (p === null || typeof p.name !== "string") {
    throw new ProfileRpcError(-32602, "profile.create requires name");
  }
  await ctx.manager.create(p.name);
  return { kind: "hit", value: { name: p.name } };
}
```

- [ ] **Step 4: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.create"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/profile-rpc.ts packages/gateway/src/ipc/profile-rpc.test.ts
git commit -m "feat(ipc): profile.create with validation"
```

### Task 9: `profile.switch`

**Files:**
- Modify: `packages/gateway/src/ipc/profile-rpc.ts`
- Modify: `packages/gateway/src/ipc/profile-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("profile.switch", () => {
  test("switches active profile and emits profile.switched", async () => {
    const mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
    await mgr.create("work");
    const notifications: { method: string; params: unknown }[] = [];
    const r = await dispatchProfileRpc(
      "profile.switch",
      { name: "work" },
      { manager: mgr, notify: (m, p) => notifications.push({ method: m, params: p }) },
    );
    expect(r.kind).toBe("hit");
    expect(await mgr.getActive()).toBe("work");
    expect(notifications.some((n) => n.method === "profile.switched")).toBe(true);
  });

  test("rejects unknown profile", async () => {
    const mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
    await expect(
      dispatchProfileRpc("profile.switch", { name: "ghost" }, { manager: mgr }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.switch"
```

- [ ] **Step 3: Add the case**

```ts
case "profile.switch": {
  const p = params as { name?: unknown } | null;
  if (p === null || typeof p.name !== "string") {
    throw new ProfileRpcError(-32602, "profile.switch requires name");
  }
  await ctx.manager.switchTo(p.name);
  ctx.notify?.("profile.switched", { name: p.name });
  return { kind: "hit", value: { active: p.name } };
}
```

- [ ] **Step 4: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.switch"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/profile-rpc.ts packages/gateway/src/ipc/profile-rpc.test.ts
git commit -m "feat(ipc): profile.switch with profile.switched notification"
```

### Task 10: `profile.delete`

**Files:**
- Modify: `packages/gateway/src/ipc/profile-rpc.ts`
- Modify: `packages/gateway/src/ipc/profile-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("profile.delete", () => {
  test("deletes a non-active profile", async () => {
    const mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
    await mgr.create("work");
    await mgr.create("personal");
    await mgr.switchTo("work");
    const r = await dispatchProfileRpc("profile.delete", { name: "personal" }, { manager: mgr });
    expect(r.kind).toBe("hit");
    expect((await mgr.list()).map((p) => p.name)).toEqual(["work"]);
  });

  test("refuses to delete the active profile", async () => {
    const mgr = new ProfileManager(mkdtempSync(join(tmpdir(), "nimbus-prof-")));
    await mgr.create("work");
    await mgr.switchTo("work");
    await expect(
      dispatchProfileRpc("profile.delete", { name: "work" }, { manager: mgr }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.delete"
```

- [ ] **Step 3: Add the case**

```ts
case "profile.delete": {
  const p = params as { name?: unknown } | null;
  if (p === null || typeof p.name !== "string") {
    throw new ProfileRpcError(-32602, "profile.delete requires name");
  }
  await ctx.manager.delete(p.name);
  return { kind: "hit", value: { deleted: p.name } };
}
```

- [ ] **Step 4: Run the tests; expect PASS**

```bash
bun test packages/gateway/src/ipc/profile-rpc.test.ts -t "profile.delete"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/profile-rpc.ts packages/gateway/src/ipc/profile-rpc.test.ts
git commit -m "feat(ipc): profile.delete with active-profile guard"
```

---

## Phase 3 — Telemetry IPC

The telemetry collector exposes config + counters internally. Two new methods surface those as a stable shape and toggle the collector on/off.

### Task 11: `telemetry.getStatus`

**Files:**
- Modify: `packages/gateway/src/telemetry/collector.ts`
- Modify: `packages/gateway/src/ipc/diagnostics-rpc.ts`
- Test: `packages/gateway/src/ipc/diagnostics-rpc.test.ts` (create if missing)

- [ ] **Step 1: Read the collector shape**

Open `packages/gateway/src/telemetry/collector.ts` and identify: the `enabled` flag, the counter fields (`eventsSent`, `bytesSent`, etc.), and the `lastFlushAt` timestamp. Adjust field names in Step 3 to match the actual collector. If the collector does not expose a `getState()` method, add one.

- [ ] **Step 2: Write the failing test**

Add to `packages/gateway/src/ipc/diagnostics-rpc.test.ts` (create with the existing imports if the file is new):

```ts
import { describe, test, expect } from "bun:test";
import { dispatchDiagnosticsRpc } from "./diagnostics-rpc.ts";

describe("telemetry.getStatus", () => {
  test("returns enabled + counters snapshot", async () => {
    const fakeCollector = {
      getState: () => ({
        enabled: true,
        eventsSent: 42,
        bytesSent: 8192,
        lastFlushAt: 1_700_000_000_000,
      }),
    };
    const r = await dispatchDiagnosticsRpc("telemetry.getStatus", null, {
      telemetry: fakeCollector,
    } as unknown as Parameters<typeof dispatchDiagnosticsRpc>[2]);
    expect(r.kind).toBe("hit");
    const v = (r as { value: { enabled: boolean } }).value;
    expect(v.enabled).toBe(true);
  });
});
```

- [ ] **Step 3: Add a `getState()` method to the telemetry collector**

In `packages/gateway/src/telemetry/collector.ts`, add (adjust property names to the real collector):

```ts
getState(): { enabled: boolean; eventsSent: number; bytesSent: number; lastFlushAt: number | null } {
  return {
    enabled: this.enabled,
    eventsSent: this.eventsSent,
    bytesSent: this.bytesSent,
    lastFlushAt: this.lastFlushAt ?? null,
  };
}
```

- [ ] **Step 4: Add the RPC case**

In `dispatchDiagnosticsRpc`, add inside the `switch`:

```ts
case "telemetry.getStatus":
  return { kind: "hit", value: ctx.telemetry.getState() };
```

Extend the `DiagnosticsRpcContext` type to include `telemetry: { getState(): ReturnType<TelemetryCollector["getState"]> }`.

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/diagnostics-rpc.test.ts -t "telemetry.getStatus"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/telemetry/collector.ts packages/gateway/src/ipc/diagnostics-rpc.ts packages/gateway/src/ipc/diagnostics-rpc.test.ts
git commit -m "feat(ipc): telemetry.getStatus exposes collector state snapshot"
```

### Task 12: `telemetry.setEnabled`

**Files:**
- Modify: `packages/gateway/src/telemetry/collector.ts`
- Modify: `packages/gateway/src/ipc/diagnostics-rpc.ts`
- Modify: `packages/gateway/src/ipc/diagnostics-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("telemetry.setEnabled", () => {
  test("flips enabled and writes an audit row", async () => {
    let currentlyEnabled = true;
    const audit = { append: mock(() => {}) };
    const fakeCollector = {
      getState: () => ({ enabled: currentlyEnabled, eventsSent: 0, bytesSent: 0, lastFlushAt: null }),
      setEnabled: (e: boolean) => {
        currentlyEnabled = e;
      },
    };
    const ctx = { telemetry: fakeCollector, audit } as unknown as Parameters<
      typeof dispatchDiagnosticsRpc
    >[2];
    const r = await dispatchDiagnosticsRpc("telemetry.setEnabled", { enabled: false }, ctx);
    expect(r.kind).toBe("hit");
    expect(currentlyEnabled).toBe(false);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/diagnostics-rpc.test.ts -t "telemetry.setEnabled"
```

- [ ] **Step 3: Extend the collector**

Ensure `TelemetryCollector` has a `setEnabled(enabled: boolean): void` method — if not, add one that updates the internal flag and persists to the config file (mirroring whatever `telemetry.disableMark` does today).

- [ ] **Step 4: Add the RPC case**

```ts
case "telemetry.setEnabled": {
  const p = params as { enabled?: unknown } | null;
  if (p === null || typeof p.enabled !== "boolean") {
    return { kind: "hit", value: { error: "telemetry.setEnabled requires enabled:boolean" } };
  }
  ctx.telemetry.setEnabled(p.enabled);
  ctx.audit?.append?.({
    kind: "telemetry.setEnabled",
    outcome: "ok",
    details: { enabled: p.enabled },
  });
  return { kind: "hit", value: { enabled: p.enabled } };
}
```

Extend `DiagnosticsRpcContext` with `audit?: { append(entry: unknown): void }` if not already present.

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/diagnostics-rpc.test.ts -t "telemetry.setEnabled"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/telemetry/collector.ts packages/gateway/src/ipc/diagnostics-rpc.ts packages/gateway/src/ipc/diagnostics-rpc.test.ts
git commit -m "feat(ipc): telemetry.setEnabled toggles collector + writes audit row"
```

---

## Phase 4 — Data preflight + progress

Adds the two preflight methods the Data panel needs before export/delete, plus progress-notification emission from the existing `data.export` / `data.import` handlers (read the existing `data-rpc.ts` first — if progress is already emitted, the task becomes a verification-only commit).

### Task 13: `data.getExportPreflight`

**Files:**
- Modify: `packages/gateway/src/ipc/data-rpc.ts`
- Modify: `packages/gateway/src/ipc/data-rpc.test.ts`

- [ ] **Step 1: Read the existing data-rpc handlers**

Open `packages/gateway/src/ipc/data-rpc.ts` in full. Confirm the exact signatures of `handleDataExport`, `handleDataImport`, `handleDataDelete`, and what `ctx` provides. The preflight method must reuse whatever index+vault handles those handlers already accept.

- [ ] **Step 2: Write the failing test**

Add to `data-rpc.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { dispatchDataRpc } from "./data-rpc.ts";

describe("data.getExportPreflight", () => {
  test("returns lastExportAt + estimatedSizeBytes + itemCount", async () => {
    const idx = {
      countItems: () => 1000,
      approxDbSizeBytes: () => 50 * 1024 * 1024,
      lastExportAt: () => 1_700_000_000_000,
    };
    const r = await dispatchDataRpc("data.getExportPreflight", null, { index: idx } as unknown as Parameters<typeof dispatchDataRpc>[2]);
    expect(r.kind).toBe("hit");
    const v = (r as { value: { itemCount: number } }).value;
    expect(v.itemCount).toBe(1000);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "getExportPreflight"
```

- [ ] **Step 4: Implement the handler**

Add near the top of `data-rpc.ts`:

```ts
function handleExportPreflight(ctx: { index: LocalIndex }) {
  return {
    lastExportAt: typeof (ctx.index as { lastExportAt?: () => number }).lastExportAt === "function"
      ? (ctx.index as { lastExportAt: () => number }).lastExportAt()
      : null,
    estimatedSizeBytes: typeof (ctx.index as { approxDbSizeBytes?: () => number }).approxDbSizeBytes === "function"
      ? (ctx.index as { approxDbSizeBytes: () => number }).approxDbSizeBytes()
      : 0,
    itemCount: typeof (ctx.index as { countItems?: () => number }).countItems === "function"
      ? (ctx.index as { countItems: () => number }).countItems()
      : 0,
  };
}
```

Then add the dispatch case before the fallthrough return:

```ts
if (method === "data.getExportPreflight") {
  return { kind: "hit", value: handleExportPreflight(ctx) };
}
```

If the `LocalIndex` class doesn't yet have `countItems` / `approxDbSizeBytes` / `lastExportAt`, add thin methods that run the corresponding SQL (`SELECT COUNT(*) FROM items`, `PRAGMA page_count * PRAGMA page_size`, and a `SELECT MAX(created_at) FROM ... WHERE kind='data.export'` from `audit_log`).

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "getExportPreflight"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/data-rpc.ts packages/gateway/src/ipc/data-rpc.test.ts
git commit -m "feat(ipc): data.getExportPreflight returns lastExportAt + estimatedSize + itemCount"
```

### Task 14: `data.getDeletePreflight`

**Files:**
- Modify: `packages/gateway/src/ipc/data-rpc.ts`
- Modify: `packages/gateway/src/ipc/data-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("data.getDeletePreflight", () => {
  test("returns per-service counts", async () => {
    const idx = {
      countItemsByService: (s: string) => (s === "github" ? 1247 : 0),
      countEmbeddingsByService: (s: string) => (s === "github" ? 89 : 0),
      countVaultKeysForService: (s: string) => (s === "github" ? 3 : 0),
    };
    const r = await dispatchDataRpc(
      "data.getDeletePreflight",
      { service: "github" },
      { index: idx } as unknown as Parameters<typeof dispatchDataRpc>[2],
    );
    expect(r.kind).toBe("hit");
    const v = (r as { value: { itemCount: number } }).value;
    expect(v.itemCount).toBe(1247);
  });

  test("rejects missing service", async () => {
    await expect(
      dispatchDataRpc("data.getDeletePreflight", null, {} as unknown as Parameters<typeof dispatchDataRpc>[2]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "getDeletePreflight"
```

- [ ] **Step 3: Implement the handler**

```ts
function handleDeletePreflight(params: unknown, ctx: { index: LocalIndex }) {
  const p = params as { service?: unknown } | null;
  if (p === null || typeof p.service !== "string") {
    throw new Error("data.getDeletePreflight requires service:string");
  }
  const idx = ctx.index as unknown as {
    countItemsByService: (s: string) => number;
    countEmbeddingsByService: (s: string) => number;
    countVaultKeysForService: (s: string) => number;
  };
  return {
    service: p.service,
    itemCount: idx.countItemsByService(p.service),
    embeddingCount: idx.countEmbeddingsByService(p.service),
    vaultKeyCount: idx.countVaultKeysForService(p.service),
  };
}
```

Add the dispatch line:

```ts
if (method === "data.getDeletePreflight") {
  return { kind: "hit", value: handleDeletePreflight(params, ctx) };
}
```

If `countItemsByService` etc. don't exist on `LocalIndex`, add them (simple `SELECT COUNT(*) FROM items WHERE service=?`, and the vault-key counter walks `CONNECTOR_VAULT_SECRET_KEYS` for that service).

- [ ] **Step 4: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "getDeletePreflight"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/data-rpc.ts packages/gateway/src/ipc/data-rpc.test.ts
git commit -m "feat(ipc): data.getDeletePreflight returns per-service item/embedding/vault-key counts"
```

### Task 15: `data.exportProgress` / `data.importProgress` notifications

**Files:**
- Modify: `packages/gateway/src/ipc/data-rpc.ts`
- Modify: `packages/gateway/src/ipc/data-rpc.test.ts`
- Modify: `packages/gateway/src/commands/data-export.ts` (if the file exists; otherwise the logic lives inline in `data-rpc.ts`)

- [ ] **Step 1: Read both sources**

Open both `data-rpc.ts` and `packages/gateway/src/commands/data-export.ts` (and `data-import.ts` if present). Locate the loops that write tar entries during export and read tar entries during import. These are the emission points.

- [ ] **Step 2: Write the failing test**

```ts
describe("data.export emits progress notifications", () => {
  test("emits at least one exportProgress and one exportCompleted", async () => {
    const notifications: { method: string; params: unknown }[] = [];
    const ctx = {
      index: /* a minimal fake or a real ephemeral test index */ {} as never,
      vault: {} as never,
      audit: { append: () => {} },
      notify: (m: string, p: unknown) => notifications.push({ method: m, params: p }),
    };
    // Replace with whatever makes `handleDataExport` actually run end-to-end against a test index.
    await dispatchDataRpc(
      "data.export",
      { path: "/tmp/nimbus-export-test.tar.gz", passphrase: "test-passphrase-abc", includeIndex: false },
      ctx as unknown as Parameters<typeof dispatchDataRpc>[2],
    );
    expect(notifications.some((n) => n.method === "data.exportProgress")).toBe(true);
    expect(notifications.some((n) => n.method === "data.exportCompleted")).toBe(true);
  });
});
```

> **Setup caveat:** running a real export end-to-end requires a minimal vault + index fixture. Mirror the fixture used by the existing `data-rpc.test.ts` "data.export round-trips" test if there is one; otherwise skip end-to-end here and assert only on a mocked export path by refactoring `handleDataExport` to accept a `notify` callback.

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "emits progress"
```

- [ ] **Step 4: Thread `notify` through the export handler**

Change `handleDataExport(rec, ctx)` signature to accept `ctx.notify`. At the start of each tar entry emit:

```ts
ctx.notify?.("data.exportProgress", {
  stage: "writing",
  entry: entryName,
  bytesWritten: bytesSoFar,
  totalBytes: estimatedTotal,
});
```

After the archive is closed and hashed:

```ts
ctx.notify?.("data.exportCompleted", { path, sizeBytes: finalSize });
```

Do the mirror changes in `handleDataImport` (`data.importProgress`, `data.importCompleted`).

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/data-rpc.test.ts -t "emits progress"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/data-rpc.ts packages/gateway/src/ipc/data-rpc.test.ts packages/gateway/src/commands/data-export.ts
git commit -m "feat(ipc): emit data.exportProgress/importProgress + *Completed notifications during tar streaming"
```

---

## Phase 5 — Audit + Diag alignment

### Task 16: `audit.getSummary`

**Files:**
- Modify: `packages/gateway/src/index/local-index.ts` (add `getAuditSummary`)
- Modify: `packages/gateway/src/ipc/audit-rpc.ts`
- Modify: `packages/gateway/src/ipc/audit-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `audit-rpc.test.ts`:

```ts
describe("audit.getSummary", () => {
  test("returns counts grouped by outcome and by service", async () => {
    const idx = {
      getAuditSummary: () => ({
        byOutcome: { ok: 140, rejected: 5, failed: 2 },
        byService: { github: 80, filesystem: 67 },
        total: 147,
      }),
    };
    const r = await dispatchAuditRpc("audit.getSummary", null, { index: idx } as unknown as Parameters<typeof dispatchAuditRpc>[2]);
    expect(r.kind).toBe("hit");
    const v = (r as { value: { total: number } }).value;
    expect(v.total).toBe(147);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/audit-rpc.test.ts -t "getSummary"
```

- [ ] **Step 3: Implement `LocalIndex.getAuditSummary`**

In `packages/gateway/src/index/local-index.ts`:

```ts
getAuditSummary(): { byOutcome: Record<string, number>; byService: Record<string, number>; total: number } {
  const byOutcome: Record<string, number> = {};
  const byService: Record<string, number> = {};
  let total = 0;
  const outcomes = this.db
    .query("SELECT outcome, COUNT(*) AS c FROM audit_log GROUP BY outcome")
    .all() as { outcome: string; c: number }[];
  for (const r of outcomes) {
    byOutcome[r.outcome] = r.c;
    total += r.c;
  }
  const services = this.db
    .query("SELECT service, COUNT(*) AS c FROM audit_log WHERE service IS NOT NULL GROUP BY service")
    .all() as { service: string; c: number }[];
  for (const r of services) byService[r.service] = r.c;
  return { byOutcome, byService, total };
}
```

- [ ] **Step 4: Add the RPC case**

In `dispatchAuditRpc`, before the `miss` return:

```ts
if (method === "audit.getSummary") {
  const idx = ensureIndex(ctx);
  return { kind: "hit", value: idx.getAuditSummary() };
}
```

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/audit-rpc.test.ts -t "getSummary"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/index/local-index.ts packages/gateway/src/ipc/audit-rpc.ts packages/gateway/src/ipc/audit-rpc.test.ts
git commit -m "feat(ipc): audit.getSummary returns counts by outcome + service"
```

### Task 17: `audit.export` alias

**Files:**
- Modify: `packages/gateway/src/ipc/audit-rpc.ts`
- Modify: `packages/gateway/src/ipc/audit-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("audit.export (alias for audit.exportAll)", () => {
  test("returns the same shape as audit.exportAll", async () => {
    const r1 = await dispatchAuditRpc("audit.exportAll", null, { index: fakeIndex } as any);
    const r2 = await dispatchAuditRpc("audit.export", null, { index: fakeIndex } as any);
    expect(r1).toEqual(r2);
  });
});
```

(`fakeIndex` here refers to whatever shared test fixture is already used in `audit-rpc.test.ts`; reuse it.)

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/audit-rpc.test.ts -t "audit.export"
```

- [ ] **Step 3: Add the alias**

In `dispatchAuditRpc`, change:

```ts
if (method === "audit.exportAll") {
```

to:

```ts
if (method === "audit.exportAll" || method === "audit.export") {
```

- [ ] **Step 4: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/audit-rpc.test.ts -t "audit.export"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/audit-rpc.ts packages/gateway/src/ipc/audit-rpc.test.ts
git commit -m "feat(ipc): audit.export as alias for audit.exportAll"
```

### Task 18: `diag.getVersion`

**Files:**
- Modify: `packages/gateway/src/ipc/diagnostics-rpc.ts`
- Modify: `packages/gateway/src/ipc/diagnostics-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("diag.getVersion", () => {
  test("returns gateway version + commit + buildId", async () => {
    const r = await dispatchDiagnosticsRpc("diag.getVersion", null, {} as unknown as Parameters<typeof dispatchDiagnosticsRpc>[2]);
    expect(r.kind).toBe("hit");
    const v = (r as { value: { version: string } }).value;
    expect(typeof v.version).toBe("string");
    expect(v.version.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/diagnostics-rpc.test.ts -t "diag.getVersion"
```

- [ ] **Step 3: Add the case**

In `packages/gateway/src/ipc/diagnostics-rpc.ts`, add before `default`:

```ts
case "diag.getVersion": {
  const pkg = (await import("../../package.json", { with: { type: "json" } })).default as { version?: string };
  return {
    kind: "hit",
    value: {
      version: pkg.version ?? "0.0.0-dev",
      commit: process.env["NIMBUS_BUILD_COMMIT"] ?? null,
      buildId: process.env["NIMBUS_BUILD_ID"] ?? null,
    },
  };
}
```

If dynamic JSON import is not supported in Bun's current mode, read `package.json` via `Bun.file(...).json()` at startup once and cache the version on `ctx`.

- [ ] **Step 4: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/diagnostics-rpc.test.ts -t "diag.getVersion"
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ipc/diagnostics-rpc.ts packages/gateway/src/ipc/diagnostics-rpc.test.ts
git commit -m "feat(ipc): diag.getVersion returns gateway version + commit + buildId"
```

---

## Phase 6 — Connector unified config

### Task 19: `connector.setConfig`

**Files:**
- Modify: `packages/gateway/src/ipc/connector-rpc.ts`
- Modify: `packages/gateway/src/ipc/connector-rpc.test.ts` (create if missing)

- [ ] **Step 1: Read the existing setInterval / pause / resume handlers**

Open `packages/gateway/src/ipc/connector-rpc.ts`. Find the `connector.setInterval`, `connector.pause`, `connector.resume` handlers and their underlying calls on whatever manager they delegate to. The new `setConfig` composes these.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, test, expect, mock } from "bun:test";
import { dispatchConnectorRpc } from "./connector-rpc.ts";

describe("connector.setConfig", () => {
  test("applies intervalMs + enabled flip + returns the resulting config", async () => {
    const setInterval = mock(async () => {});
    const pause = mock(async () => {});
    const resume = mock(async () => {});
    const mgr = { setInterval, pause, resume } as unknown as Parameters<typeof dispatchConnectorRpc>[2];
    const r = await dispatchConnectorRpc(
      "connector.setConfig",
      { service: "github", intervalMs: 60000, enabled: true },
      mgr,
    );
    expect(r.kind).toBe("hit");
    expect(setInterval).toHaveBeenCalledWith("github", 60000);
    expect(resume).toHaveBeenCalledWith("github");
  });

  test("missing service rejected", async () => {
    await expect(
      dispatchConnectorRpc("connector.setConfig", {}, {} as unknown as Parameters<typeof dispatchConnectorRpc>[2]),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/connector-rpc.test.ts -t "setConfig"
```

- [ ] **Step 4: Add the case**

In `connector-rpc.ts` before `default`:

```ts
case "connector.setConfig": {
  const p = params as { service?: unknown; intervalMs?: unknown; enabled?: unknown } | null;
  if (p === null || typeof p.service !== "string") {
    throw new Error("connector.setConfig requires service:string");
  }
  if (typeof p.intervalMs === "number") {
    await ctx.manager.setInterval(p.service, p.intervalMs);
  }
  if (typeof p.enabled === "boolean") {
    if (p.enabled) await ctx.manager.resume(p.service);
    else await ctx.manager.pause(p.service);
  }
  return {
    kind: "hit",
    value: {
      service: p.service,
      intervalMs: typeof p.intervalMs === "number" ? p.intervalMs : null,
      enabled: typeof p.enabled === "boolean" ? p.enabled : null,
    },
  };
}
```

- [ ] **Step 5: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/connector-rpc.test.ts -t "setConfig"
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/ipc/connector-rpc.ts packages/gateway/src/ipc/connector-rpc.test.ts
git commit -m "feat(ipc): connector.setConfig composes setInterval + pause/resume"
```

---

## Phase 7 — Updater download progress

### Task 20: Emit `updater.downloadProgress` during binary download

**Files:**
- Modify: `packages/gateway/src/updater/updater.ts`
- Modify: `packages/gateway/src/ipc/updater-rpc.ts`
- Modify: `packages/gateway/src/ipc/updater-rpc.test.ts`

- [ ] **Step 1: Read the existing download path**

Open `packages/gateway/src/updater/updater.ts` and find where the candidate binary is fetched (likely a `fetch` with a `ReadableStream`). Confirm whether a progress hook is already wired. If so, only the RPC-side emission is missing; jump to Step 4.

- [ ] **Step 2: Write the failing test**

Add to `updater-rpc.test.ts`:

```ts
describe("updater download emits downloadProgress", () => {
  test("emits progress chunks during applyUpdate's download phase", async () => {
    const notifications: { method: string; params: unknown }[] = [];
    const fakeUpdater = {
      applyUpdate: async (onProgress?: (p: { bytes: number; total: number }) => void) => {
        onProgress?.({ bytes: 100, total: 1000 });
        onProgress?.({ bytes: 1000, total: 1000 });
        return { applied: true };
      },
    };
    const ctx = {
      updater: fakeUpdater,
      notify: (m: string, p: unknown) => notifications.push({ method: m, params: p }),
    } as unknown as Parameters<typeof dispatchUpdaterRpc>[2];
    await dispatchUpdaterRpc("updater.applyUpdate", null, ctx);
    expect(notifications.filter((n) => n.method === "updater.downloadProgress")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test packages/gateway/src/ipc/updater-rpc.test.ts -t "downloadProgress"
```

- [ ] **Step 4: Thread a progress callback through `Updater.applyUpdate`**

In `updater.ts`, extend the `applyUpdate` signature:

```ts
async applyUpdate(onProgress?: (p: { bytes: number; total: number }) => void): Promise<{ applied: boolean }> {
  // ... existing logic ...
  // Replace the raw `await resp.body` with a reader that calls onProgress after each chunk:
  const reader = resp.body?.getReader();
  const total = Number(resp.headers.get("content-length") ?? 0);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader !== undefined) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        chunks.push(value);
        bytes += value.byteLength;
        onProgress?.({ bytes, total });
      }
    }
  }
  // Continue with signature verification over the concatenated buffer.
}
```

- [ ] **Step 5: Emit from the RPC dispatcher**

In `updater-rpc.ts`, modify the `applyUpdate` case:

```ts
case "updater.applyUpdate": {
  const result = await ctx.updater.applyUpdate((p) =>
    ctx.notify?.("updater.downloadProgress", p),
  );
  return { kind: "hit", value: result };
}
```

Extend `UpdaterRpcContext` with `notify?: (method: string, params: unknown) => void;` if not already present, and wire the notifier in `server.ts`.

- [ ] **Step 6: Run the test; expect PASS**

```bash
bun test packages/gateway/src/ipc/updater-rpc.test.ts -t "downloadProgress"
```

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/updater/updater.ts packages/gateway/src/ipc/updater-rpc.ts packages/gateway/src/ipc/updater-rpc.test.ts
git commit -m "feat(ipc): emit updater.downloadProgress during applyUpdate's fetch loop"
```

---

## Post-flight (do once after Task 20)

- [ ] **Step A — Run full test suite on all three subsystems**

```bash
bun run typecheck && bun test && bun run lint
```

Expected: all green. Fix any regressions before opening the PR.

- [ ] **Step B — Run coverage on touched packages**

```bash
bun run test:coverage
```

Expected: `packages/gateway/src/llm/` ≥ 85%, `packages/gateway/src/ipc/` at or above its existing threshold. If a file's coverage dropped, add focused tests — do not lower the gate.

- [ ] **Step C — Update the WS5-C spec's §7 checklist**

Open `docs/superpowers/specs/2026-04-19-ws5c-settings-design.md` and tick the "plan-writing verification checklist" items that this plan has satisfied. Add a short note under §1.3 Success gates:

> **Plan 1 (Gateway IPC plumbing) landed:** all 27 methods WS5-C Settings UI consumes now exist over IPC. See `docs/superpowers/plans/2026-04-19-ws5c-gateway-ipc-plumbing.md`.

- [ ] **Step D — Open the PR**

```bash
gh pr create \
  --base dev/asafgolombek/phase_4_ws5 \
  --title "feat(gateway): WS5-C IPC plumbing (LLM control, profiles, telemetry, data preflight, audit summary, connector config, updater progress)" \
  --body "$(cat <<'EOF'
## Summary

Adds the Gateway-side JSON-RPC surface the WS5-C Settings UI consumes. All additions are additive — no breaking changes to existing methods or CLI behavior.

- LLM: pullModel (streaming progress) + load/unload + setDefault (V18 schema) + getRouterStatus + cancelPull
- Profiles: new ProfileManager + profile.list/create/switch/delete
- Telemetry: getStatus + setEnabled (with audit)
- Data: getExportPreflight + getDeletePreflight + data.exportProgress/importProgress notifications
- Audit: getSummary + audit.export alias
- Diag: getVersion
- Connector: setConfig composes setInterval + pause/resume
- Updater: downloadProgress notification emitted during applyUpdate

See plan: `docs/superpowers/plans/2026-04-19-ws5c-gateway-ipc-plumbing.md`

## Test plan

- [ ] `bun run typecheck` green
- [ ] `bun test` green on all three OSes (CI matrix)
- [ ] `bun run lint` green
- [ ] Coverage unchanged or improved for `packages/gateway/src/llm/` and `packages/gateway/src/ipc/`
- [ ] Manual smoke: invoke each new method via `nimbus-ipc-client` repl (or the existing integration-test harness); verify notifications fire for pullModel + export + download

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Plan Self-Review (filled out by plan writer)

**Spec coverage.** The WS5-C spec §3.1 (12 reads) and §3.2 (15 writes) list the methods the UI consumes. Mapping to tasks:

| Method | Task |
|---|---|
| `llm.listModels` | pre-existing (no task) |
| `llm.getRouterStatus` | Task 5 |
| `llm.pullModel` | Task 2 |
| `llm.loadModel` / `unloadModel` | Task 3 |
| `llm.setDefault` | Task 4 |
| `llm.cancelPull` | Task 2 (same dispatcher) |
| `connector.list` | reuses pre-existing `connector.listStatus` — no Gateway work |
| `connector.setConfig` | Task 19 |
| `profile.list` | Task 7 |
| `profile.create` | Task 8 |
| `profile.switch` | Task 9 |
| `profile.delete` | Task 10 |
| `telemetry.getStatus` | Task 11 |
| `telemetry.setEnabled` | Task 12 |
| `audit.getSummary` | Task 16 |
| `audit.verify` / `audit.list` | pre-existing |
| `audit.export` | Task 17 (alias) |
| `data.getExportPreflight` | Task 13 |
| `data.getDeletePreflight` | Task 14 |
| `data.export` / `data.import` / `data.delete` | pre-existing; Task 15 adds progress notifications |
| `updater.getStatus` / `checkNow` / `applyUpdate` / `rollback` | pre-existing; Task 20 adds `downloadProgress` |
| `diag.getVersion` | Task 18 |

No gaps.

**Placeholder scan.** No "TBD" / "TODO" / "fill in details" / "similar to Task N" strings — every task has self-contained test + implementation code blocks. Two tasks (Task 11 collector field names, Task 15 end-to-end fixture) carry explicit "read the existing file first" steps because the exact subsystem shape is not known from outside the gateway source; the plan tells the executor how to discover the shape, not a placeholder to invent one.

**Type consistency.** `PullProgressChunk` defined in Task 1 is imported consistently in Task 2. `LlmRpcContext` extended in Task 2 and reused verbatim in Tasks 3/4/5. `ProfileManager` methods (`list`, `getActive`, `create`, `switchTo`, `delete`) referenced consistently in Tasks 7–10. `LocalIndex` new methods (`countItems`, `countItemsByService`, `getAuditSummary`) declared in the tasks that add them.

**Scope.** One feature branch, one PR, ~20 tasks. Independently shippable; does not block Plan 2 from starting Phase 1 of its own UI work in parallel once Phase 1 (LLM) lands here.
