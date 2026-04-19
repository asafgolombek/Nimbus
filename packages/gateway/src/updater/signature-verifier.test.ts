import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { verifyBinarySignature } from "./signature-verifier.ts";

function makeKeypair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const seed = new Uint8Array(randomBytes(32));
  return nacl.sign.keyPair.fromSeed(seed);
}

function signDigest(secretKey: Uint8Array, binary: Uint8Array): Uint8Array {
  const digest = createHash("sha256").update(binary).digest();
  return nacl.sign.detached(new Uint8Array(digest), secretKey);
}

describe("verifyBinarySignature", () => {
  test("accepts a valid signature", () => {
    const kp = makeKeypair();
    const binary = new Uint8Array(randomBytes(4096));
    const sig = signDigest(kp.secretKey, binary);
    expect(verifyBinarySignature(binary, sig, kp.publicKey)).toBe(true);
  });

  test("rejects when binary is modified", () => {
    const kp = makeKeypair();
    const binary = new Uint8Array(randomBytes(4096));
    const sig = signDigest(kp.secretKey, binary);
    binary[0] = (binary[0] ?? 0) ^ 0xff;
    expect(verifyBinarySignature(binary, sig, kp.publicKey)).toBe(false);
  });

  test("rejects with wrong public key", () => {
    const kpA = makeKeypair();
    const kpB = makeKeypair();
    const binary = new Uint8Array(randomBytes(4096));
    const sig = signDigest(kpA.secretKey, binary);
    expect(verifyBinarySignature(binary, sig, kpB.publicKey)).toBe(false);
  });

  test("rejects truncated signature", () => {
    const kp = makeKeypair();
    const binary = new Uint8Array(randomBytes(4096));
    const sig = signDigest(kp.secretKey, binary);
    expect(verifyBinarySignature(binary, sig.slice(0, 63), kp.publicKey)).toBe(false);
  });

  test("rejects signature of wrong key length", () => {
    const kp = makeKeypair();
    const binary = new Uint8Array(randomBytes(4096));
    const sig = signDigest(kp.secretKey, binary);
    expect(verifyBinarySignature(binary, sig, kp.publicKey.slice(0, 31))).toBe(false);
  });
});
