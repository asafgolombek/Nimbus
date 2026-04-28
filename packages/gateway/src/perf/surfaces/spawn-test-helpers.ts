/**
 * Test-only fake `Bun.spawn` factories for surface driver unit tests.
 *
 * Lives next to the drivers (rather than a top-level fixtures module) so
 * each driver and its test stay together — the import path mirrors the
 * driver path. Not used in production code.
 */

/** A fake `Bun.spawn` whose child has no output and exits 0 immediately. */
export function fakeSpawnExitsClean(): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      stderr: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

/**
 * A fake Bun.spawn whose child:
 *  - emits the configured stdoutChunks (and optional stderrChunks) at low cadence,
 *  - blocks `exited` until kill() is called when waitForKill=true, otherwise
 *    resolves immediately with exitCode (default 0).
 *
 * Used by the spawn-and-warm helper tests (Task 4) and the S6/S7 driver
 * tests (Tasks 10, 11, 13, 14, 15) to drive a synthetic gateway lifecycle
 * without booting a real child.
 */
export interface FakeSpawnEmitsMarkerOptions {
  pid?: number;
  stdoutChunks?: string[];
  stderrChunks?: string[];
  /** When true, exited resolves only after kill(). Default true. */
  waitForKill?: boolean;
  exitCode?: number;
  /** Delay between chunk emissions (ms). Default 1. */
  chunkDelayMs?: number;
}

function chunkedReadableStream(chunks: string[], chunkDelayMs: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
        await new Promise((r) => setTimeout(r, chunkDelayMs));
      }
      controller.close();
    },
  });
}

export function fakeSpawnEmitsMarker(opts: FakeSpawnEmitsMarkerOptions): typeof Bun.spawn {
  return ((..._args: unknown[]) => {
    const chunkDelayMs = opts.chunkDelayMs ?? 1;
    let killed = false;
    const waitForKill = opts.waitForKill ?? true;
    const exited = waitForKill
      ? new Promise<number>((resolve) => {
          const tick = (): void => {
            if (killed) resolve(opts.exitCode ?? 0);
            else setTimeout(tick, 5);
          };
          tick();
        })
      : Promise.resolve(opts.exitCode ?? 0);
    return {
      pid: opts.pid ?? 12345,
      stdout: chunkedReadableStream(opts.stdoutChunks ?? [], chunkDelayMs),
      stderr: chunkedReadableStream(opts.stderrChunks ?? [], chunkDelayMs),
      exited,
      kill: () => {
        killed = true;
      },
    } as unknown as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}
