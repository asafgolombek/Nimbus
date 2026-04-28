/**
 * Deterministic synthetic-text generator for the S8 embedding throughput
 * benches. Produces N strings of approximately `length` characters from a
 * fixed-seed Mulberry32 PRNG over a small word vocabulary.
 *
 * The output is realistic enough that the embedding model exercises its
 * tokenizer + encoder paths (not just zero-width strings), but small
 * enough that the harness can hold the entire corpus in memory at the
 * largest tier (length=5000 × count=64 ≈ 20 MB).
 *
 * See docs/superpowers/specs/2026-04-27-perf-audit-cluster-c-design.md §6.3.
 */

export const SYNTHETIC_TEXT_DEFAULT_SEED = 0x6e696d62; // "nimb"

export interface SynthesizeTextOptions {
  /** Approximate character length per string (target; actual is within ±10%). */
  length: number;
  count: number;
  seed?: number;
}

const WORDS = [
  "context",
  "ranker",
  "vault",
  "gateway",
  "embedding",
  "vector",
  "neighbor",
  "audit",
  "watcher",
  "session",
  "graph",
  "person",
  "service",
  "metric",
  "latency",
  "throughput",
  "memory",
  "snapshot",
  "manifest",
  "cluster",
  "schema",
  "migrate",
  "transaction",
  "checkpoint",
  "rollback",
  "consent",
  "redact",
  "verify",
  "signature",
  "release",
] as const;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesizeText(opts: SynthesizeTextOptions): string[] {
  const seed = opts.seed ?? SYNTHETIC_TEXT_DEFAULT_SEED;
  const rng = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const parts: string[] = [];
    let used = 0;
    while (used < opts.length) {
      const w = WORDS[Math.floor(rng() * WORDS.length)] ?? "context";
      parts.push(w);
      used += w.length + 1; // +1 for the joining space
    }
    out.push(parts.join(" "));
  }
  return out;
}
