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
