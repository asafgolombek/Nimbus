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
