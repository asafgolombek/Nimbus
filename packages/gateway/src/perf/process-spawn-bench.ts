/**
 * Cross-process measurement primitive for surfaces that need to time a fresh
 * child invocation (S1 cold start, S4 TUI first-paint, S11 CLI overhead).
 *
 * Two modes:
 *   - "marker" — elapsed ms from spawn to first stdout/stderr regex match.
 *                The child is then sent SIGTERM and awaited.
 *   - "exit"   — elapsed ms from spawn to clean exit. The child must exit
 *                on its own.
 *
 * A timeout (default 30 s) protects against a hung child.
 *
 * See docs/superpowers/specs/2026-04-26-perf-audit-design.md §3.2 (S1, S4,
 * S11 surfaces) and the PR-B-2a plan for the call sites.
 */

export type SpawnMode = "marker" | "exit";

export interface SpawnAndTimeOptions {
  cmd: string;
  args: string[];
  mode: SpawnMode;
  /** Required when mode === "marker". */
  marker?: RegExp;
  /** Default 30000 ms. */
  timeoutMs?: number;
  /** Test-injectable spawn (defaults to Bun.spawn). */
  spawn?: typeof Bun.spawn;
  /** Optional env overrides. */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface ProcSubset {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: (signal?: number | NodeJS.Signals) => void;
}

async function readUntilMatch(
  stream: ReadableStream<Uint8Array>,
  marker: RegExp,
  onMatch: () => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      if (marker.test(buf)) {
        onMatch();
        return;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function validateMarkerOpts(opts: SpawnAndTimeOptions): void {
  if (opts.mode !== "marker") return;
  if (opts.marker === undefined) {
    throw new Error("spawnAndTimeToMarker: mode='marker' requires a marker RegExp");
  }
  if (opts.marker.global || opts.marker.sticky) {
    throw new Error("spawnAndTimeToMarker: marker must not have the g or y flag");
  }
}

function spawnChild(opts: SpawnAndTimeOptions): ProcSubset {
  const spawn = opts.spawn ?? Bun.spawn;
  const stdio = opts.mode === "exit" ? "ignore" : "pipe";
  return spawn([opts.cmd, ...opts.args], {
    stdin: "ignore",
    stdout: stdio,
    stderr: stdio,
    ...(opts.env !== undefined && { env: { ...process.env, ...opts.env } }),
  }) as unknown as ProcSubset;
}

async function runExitMode(proc: ProcSubset, start: number, timeoutMs: number): Promise<number> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`spawn-and-time timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    const elapsed = performance.now() - start;
    if (exitCode !== 0) {
      throw new Error(`child exited with code ${exitCode}`);
    }
    return elapsed;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function runMarkerMode(
  proc: ProcSubset,
  marker: RegExp,
  start: number,
  timeoutMs: number,
): Promise<number> {
  let matched = false;
  let elapsed = 0;
  const ac = new AbortController();

  // matchedPromise resolves only when onMatch fires — stream readers returning
  // void (no match found in their chunk stream) must NOT win the race.
  let resolveMatched!: () => void;
  const matchedPromise = new Promise<void>((resolve) => {
    resolveMatched = resolve;
  });

  const onMatch = (): void => {
    if (matched) return;
    matched = true;
    elapsed = performance.now() - start;
    ac.abort();
    resolveMatched();
  };

  // Kick off both stream readers; they call onMatch if the marker appears.
  // They do NOT participate in the race directly — only matchedPromise does.
  void readUntilMatch(proc.stdout, marker, onMatch, ac.signal);
  void readUntilMatch(proc.stderr, marker, onMatch, ac.signal);

  // Race: marker matched, timeout, OR child exits before marker. The exit
  // racer guards against the case where the child crashes pre-marker
  // (missing dep, port collision, invalid config) — without it the helper
  // would hang until timeoutMs.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const racers: Promise<unknown>[] = [
    matchedPromise,
    new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        if (!matched) reject(new Error(`spawn-and-time timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
    proc.exited.then((code) => {
      if (!matched && code !== 0) {
        throw new Error(`child exited with code ${code} before marker matched`);
      }
    }),
  ];

  try {
    await Promise.race(racers);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      await proc.exited;
    } catch {
      /* ignore */
    }
  }

  if (!matched) {
    throw new Error(`marker not found before timeout (${timeoutMs}ms)`);
  }
  return elapsed;
}

/**
 * Spawn a child and return the elapsed ms in the requested mode.
 * Throws on timeout or non-zero exit (in "exit" mode).
 */
export async function spawnAndTimeToMarker(opts: SpawnAndTimeOptions): Promise<number> {
  validateMarkerOpts(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = performance.now();
  const proc = spawnChild(opts);
  if (opts.mode === "exit") {
    return runExitMode(proc, start, timeoutMs);
  }
  return runMarkerMode(proc, opts.marker as RegExp, start, timeoutMs);
}
