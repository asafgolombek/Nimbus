import { processEnvGet } from "../platform/env-access.ts";
import type { Embedder } from "./types.ts";

// `@xenova/transformers` is loaded lazily inside `createLocalEmbedder` so the
// onnxruntime-node native addon (libonnxruntime.so) is not dlopen'd at gateway
// boot — only when an embedder is actually constructed. This lets the gateway
// start on hosts that lack libonnxruntime when embeddings are disabled
// (NIMBUS_SKIP_EMBEDDING_RUNTIME=1, [embedding].enabled=false, or no provider).

/**
 * Bumped when the bundled Xenova export or pooling contract changes and old cached ONNX weights must be refreshed.
 * Full on-disk semver checks can extend this in the worker.
 */
export const MINIMUM_MODEL_VERSION = "1.0.0" as const;

export const LOCAL_EMBEDDING_MODEL_ID = "all-MiniLM-L6-v2" as const;

const XENOVA_MODEL_REPO = "Xenova/all-MiniLM-L6-v2";

export type CreateLocalEmbedderOptions = {
  /** Default cache root (e.g. `{dataDir}/models`). Overridden by `NIMBUS_EMBEDDING_MODEL_DIR` when set. */
  cacheDir: string;
};

function tensorToRowVectors(tensor: {
  data: Float32Array;
  dims: readonly number[];
}): Float32Array[] {
  const dims = tensor.dims;
  if (dims.length < 2) {
    throw new Error("Unexpected embedding tensor rank");
  }
  const batch = dims[0] ?? 0;
  const width = dims[1] ?? 0;
  const out: Float32Array[] = [];
  for (let i = 0; i < batch; i++) {
    const start = i * width;
    out.push(tensor.data.slice(start, start + width));
  }
  return out;
}

/**
 * In-process embedder via `@xenova/transformers` (ONNX). First call may download weights into `cacheDir`.
 */
export async function createLocalEmbedder(options: CreateLocalEmbedderOptions): Promise<Embedder> {
  const { env, pipeline } = await import("@xenova/transformers");
  const override = processEnvGet("NIMBUS_EMBEDDING_MODEL_DIR");
  env.cacheDir = override !== undefined && override !== "" ? override : options.cacheDir;

  const pipe = await pipeline("feature-extraction", XENOVA_MODEL_REPO);

  return {
    model: LOCAL_EMBEDDING_MODEL_ID,
    dims: 384,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) {
        return [];
      }
      const output = await pipe(texts, { pooling: "mean", normalize: true });
      return tensorToRowVectors(output as { data: Float32Array; dims: readonly number[] });
    },
  };
}
