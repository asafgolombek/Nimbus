import { createHash } from "node:crypto";
import nacl from "tweetnacl";

/**
 * Verifies an Ed25519 signature over `SHA-256(binary)`.
 * Returns false on ANY failure — never throws.
 */
export function verifyBinarySignature(
  binary: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) {
    return false;
  }
  try {
    const digest = new Uint8Array(createHash("sha256").update(binary).digest());
    return nacl.sign.detached.verify(digest, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Computes lowercase hex SHA-256 of the given bytes.
 */
export function sha256Hex(binary: Uint8Array): string {
  return createHash("sha256").update(binary).digest("hex");
}

/**
 * S6-F6 — verifies an Ed25519 signature over the canonical envelope
 * `JSON.stringify({ version, target, sha256 })`. The signed envelope binds
 * the binary identity to its manifest claim, defeating manifest-substitution
 * attacks where an attacker pairs a legacy signed binary with a fresh manifest.
 * Returns false on ANY failure — never throws.
 */
export function verifyManifestEnvelope(input: {
  version: string;
  target: string;
  sha256: string;
  signature: Uint8Array;
  publicKey: Uint8Array;
}): boolean {
  if (input.signature.length !== 64 || input.publicKey.length !== 32) return false;
  const envelope = JSON.stringify({
    version: input.version,
    target: input.target,
    sha256: input.sha256,
  });
  try {
    const bytes = new TextEncoder().encode(envelope);
    return nacl.sign.detached.verify(bytes, input.signature, input.publicKey);
  } catch {
    return false;
  }
}
