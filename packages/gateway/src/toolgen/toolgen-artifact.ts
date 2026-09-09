import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonicalize } from "../extensions/canonical-json.ts";
import type { GeneratedToolArtifact } from "./toolgen-types.ts";

/**
 * The bytes the owner approves, the bytes hashed into the `tool.generate` audit row, and (PR 3)
 * the bytes signed. Deterministic regardless of property insertion order, via the same
 * `canonicalize` extension signature verification already runs on.
 *
 * `canonicalize`'s recursion cap is 32 (real manifests nest ≤4 deep), so the manifest is embedded
 * as a nested value rather than pre-flattened — `canonicalize`'s parameter type is `unknown`, so no
 * cast is needed to pass it in, and no depth limit is at risk at this shape.
 *
 * I33's rule, extended one hop: read the script ONCE so the bytes the owner approved are the bytes
 * that execute — and later the bytes that get signed.
 */
export function canonicalArtifactBytes(artifact: GeneratedToolArtifact): string {
  return canonicalize({
    toolId: artifact.toolId,
    toolName: artifact.toolName,
    description: artifact.description,
    body: artifact.body,
    approvedHosts: [...artifact.approvedHosts],
    credentialHosts: [...artifact.credentialHosts],
    manifest: artifact.manifest,
  });
}

export function artifactDigest(artifact: GeneratedToolArtifact): string {
  return bytesToHex(blake3(new TextEncoder().encode(canonicalArtifactBytes(artifact))));
}
