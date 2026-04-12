/**
 * Run a CLI and parse stdout as JSON (for kubectl / aws / az / gcloud in MCP servers).
 */

export type RunCliJsonResult = { ok: true; data: unknown } | { ok: false; message: string };

export async function runCliJson(
  command: readonly string[],
  env: Record<string, string | undefined>,
): Promise<RunCliJsonResult> {
  if (command.length === 0) {
    return { ok: false, message: "empty command" };
  }
  const proc = Bun.spawn([...command], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (code !== 0) {
    return {
      ok: false,
      message: `${command[0] ?? "cli"} exited ${String(code)}: ${err.slice(0, 500)}`,
    };
  }
  const trimmed = out.trim();
  if (trimmed === "") {
    return { ok: true, data: null };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, message: `invalid JSON from CLI: ${out.slice(0, 200)}` };
  }
}
