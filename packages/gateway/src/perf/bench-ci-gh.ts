/**
 * Thin wrapper around `gh` CLI calls used by `bench-ci.ts`. Injectable
 * `spawn` + `sleep` make the orchestrator unit-testable without a real
 * gh process. Retry policy: 3 attempts, 5 s backoff between attempts,
 * then re-throw (spec § 4.6 says the bench must not fail because diff
 * plumbing failed — `bench-ci.ts` catches the throw and proceeds as
 * first-run).
 *
 * Why this is its own file: keeps `Bun.spawn` calls out of the
 * orchestrator so the orchestrator stays pure-coordination logic.
 */

import { readFileSync } from "node:fs";

export interface GhSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GhSpawnFn = (
  args: readonly string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
) => Promise<GhSpawnResult>;

export interface GhCliOptions {
  spawn?: GhSpawnFn;
  sleep?: (ms: number) => Promise<void>;
  /** Override default 3 attempts. Tests use 1 to skip retries. */
  maxAttempts?: number;
  /** Backoff in ms; tests pass 0. */
  backoffMs?: number;
}

const DEFAULT_BACKOFF_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const NO_ARTIFACT_PATTERNS = [
  /no artifact found/i,
  /artifact .* not found/i,
  /not found.*artifact/i,
];

function defaultSpawn(): GhSpawnFn {
  return async (args, opts) => {
    const proc = Bun.spawn(["gh", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      ...(opts?.cwd !== undefined && { cwd: opts.cwd }),
      ...(opts?.env !== undefined && {
        env: { ...process.env, ...opts.env } as Record<string, string>,
      }),
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
  };
}

export class GhCli {
  readonly #spawn: GhSpawnFn;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #backoffMs: number;

  constructor(opts: GhCliOptions = {}) {
    this.#spawn = opts.spawn ?? defaultSpawn();
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  async #run(args: readonly string[]): Promise<GhSpawnResult> {
    let lastErr = "";
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const r = await this.#spawn(args);
      if (r.exitCode === 0) return r;
      lastErr = r.stderr || `gh exited ${r.exitCode}`;
      // Non-retriable: artifact-not-found is a permanent condition, not a
      // transient API error. Throw immediately so the caller can classify it.
      if (NO_ARTIFACT_PATTERNS.some((re) => re.test(lastErr))) {
        throw new Error(
          `gh ${args[0] ?? "?"} ${args[1] ?? "?"} failed after 1 attempt: ${lastErr}`,
        );
      }
      if (attempt < this.#maxAttempts) {
        await this.#sleep(this.#backoffMs);
      }
    }
    throw new Error(
      `gh ${args[0] ?? "?"} ${args[1] ?? "?"} failed after ${this.#maxAttempts} attempts: ${lastErr}`,
    );
  }

  /** Returns databaseId of latest successful run; null when stdout is empty (no such run). */
  async runListLatestSuccess(args: { workflow: string; branch: string }): Promise<number | null> {
    const r = await this.#run([
      "run",
      "list",
      "--workflow",
      args.workflow,
      "--branch",
      args.branch,
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId",
    ]);
    const out = r.stdout.trim();
    if (out === "") return null;
    const id = Number.parseInt(out, 10);
    if (!Number.isFinite(id)) return null;
    return id;
  }

  /** `gh run view <id> --json headSha`. Returns null when run is gone. */
  async runViewHeadSha(args: { runId: number }): Promise<string | null> {
    const r = await this.#run([
      "run",
      "view",
      String(args.runId),
      "--json",
      "headSha",
      "--jq",
      ".headSha",
    ]);
    const sha = r.stdout.trim();
    return sha === "" ? null : sha;
  }

  /**
   * Returns true on success, false when the artifact is gone (404 / "no
   * artifact found" stderr — treated as not-an-error per spec § 4.6).
   * Other failures bubble up as a thrown Error after retries.
   */
  async runDownloadArtifact(args: { runId: number; name: string; dir: string }): Promise<boolean> {
    try {
      await this.#run([
        "run",
        "download",
        String(args.runId),
        "--name",
        args.name,
        "--dir",
        args.dir,
      ]);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (NO_ARTIFACT_PATTERNS.some((re) => re.test(msg))) return false;
      throw err;
    }
  }

  /**
   * Note on pagination: `gh pr view --json comments` returns the first
   * page of comments (per GitHub's GraphQL connection default — typically
   * 100). For PRs with >100 comments, our marker may not appear in the
   * response and we'd post a duplicate. This is acceptable for v0.1.0
   * because typical Nimbus PRs have well under 100 comments; if it
   * becomes a problem, switch to the paginated REST endpoint
   * `gh api repos/:owner/:repo/issues/:pr/comments?per_page=100` with
   * explicit page traversal.
   */
  async prCommentList(args: { pr: number }): Promise<{ id: string; body: string }[]> {
    const r = await this.#run([
      "pr",
      "view",
      String(args.pr),
      "--json",
      "comments",
      "--jq",
      ".comments",
    ]);
    const out = r.stdout.trim();
    if (out === "") return [];
    const parsed = JSON.parse(out) as { id?: string; body?: string }[];
    return parsed
      .filter(
        (c): c is { id: string; body: string } =>
          typeof c.id === "string" && typeof c.body === "string",
      )
      .map(({ id, body }) => ({ id, body }));
  }

  async prCommentCreate(args: { pr: number; bodyFile: string }): Promise<void> {
    await this.#run(["pr", "comment", String(args.pr), "--body-file", args.bodyFile]);
  }

  async prCommentEdit(args: { commentId: string; bodyFile: string; repo: string }): Promise<void> {
    // gh CLI does not expose `pr comment --edit`; use the underlying REST
    // endpoint via `gh api`.
    const body = readFileSync(args.bodyFile, "utf8");
    await this.#run([
      "api",
      "--method",
      "PATCH",
      `/repos/${args.repo}/issues/comments/${args.commentId}`,
      "-f",
      `body=${body}`,
    ]);
  }
}
