import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2";

// Default: Argon2id — 3 iterations, 64 MB memory, 1 lane.
export type KdfParams = { t: number; m: number; p: number };
const DEFAULT_KDF: KdfParams = { t: 3, m: 64 * 1024, p: 1 };

export type VaultManifestBlob = {
  version: 1;
  /** base64, 12-byte AES-GCM IV for the manifest cipher */
  iv: string;
  /** base64 ciphertext including the 16-byte GCM tag */
  ciphertext: string;
  wraps: {
    passphrase: { salt: string; iv: string; wrapped: string };
    seed: { salt: string; iv: string; wrapped: string };
  };
  kdf: KdfParams;
};

const DEK_LEN = 32; // AES-256 key
const IV_LEN = 12; // AES-GCM recommended IV length
const TAG_LEN = 16;

function toB64(b: Uint8Array | Buffer): string {
  return Buffer.from(b).toString("base64");
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function kdf(secret: string, salt: Uint8Array, p: KdfParams): Uint8Array {
  return argon2id(new TextEncoder().encode(secret), salt, {
    t: p.t,
    m: p.m,
    p: p.p,
    dkLen: DEK_LEN,
  });
}

function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([out, cipher.getAuthTag()]));
}

function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ctWithTag: Uint8Array): Uint8Array {
  const ct = ctWithTag.subarray(0, ctWithTag.length - TAG_LEN);
  const tag = ctWithTag.subarray(ctWithTag.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

export async function encryptVaultManifest(input: {
  plaintext: string;
  passphrase: string;
  seed: string;
  kdfParams?: KdfParams;
}): Promise<VaultManifestBlob> {
  const p = input.kdfParams ?? DEFAULT_KDF;
  const dek = new Uint8Array(randomBytes(DEK_LEN));
  const iv = new Uint8Array(randomBytes(IV_LEN));
  const ct = aesGcmEncrypt(dek, iv, new TextEncoder().encode(input.plaintext));

  const passSalt = new Uint8Array(randomBytes(16));
  const passKek = kdf(input.passphrase, passSalt, p);
  const passIv = new Uint8Array(randomBytes(IV_LEN));
  const passWrapped = aesGcmEncrypt(passKek, passIv, dek);

  const seedSalt = new Uint8Array(randomBytes(16));
  const seedKek = kdf(input.seed, seedSalt, p);
  const seedIv = new Uint8Array(randomBytes(IV_LEN));
  const seedWrapped = aesGcmEncrypt(seedKek, seedIv, dek);

  return {
    version: 1,
    iv: toB64(iv),
    ciphertext: toB64(ct),
    wraps: {
      passphrase: { salt: toB64(passSalt), iv: toB64(passIv), wrapped: toB64(passWrapped) },
      seed: { salt: toB64(seedSalt), iv: toB64(seedIv), wrapped: toB64(seedWrapped) },
    },
    kdf: p,
  };
}

export async function decryptVaultManifest(
  blob: VaultManifestBlob,
  key: { passphrase?: string; seed?: string },
): Promise<string> {
  const { passphrase, seed } = key;
  let dek: Uint8Array;
  if (passphrase !== undefined) {
    const kek = kdf(passphrase, fromB64(blob.wraps.passphrase.salt), blob.kdf);
    dek = aesGcmDecrypt(
      kek,
      fromB64(blob.wraps.passphrase.iv),
      fromB64(blob.wraps.passphrase.wrapped),
    );
  } else {
    if (seed === undefined) {
      throw new Error("decryptVaultManifest: either passphrase or seed must be provided");
    }
    const kek = kdf(seed, fromB64(blob.wraps.seed.salt), blob.kdf);
    dek = aesGcmDecrypt(kek, fromB64(blob.wraps.seed.iv), fromB64(blob.wraps.seed.wrapped));
  }
  const plaintext = aesGcmDecrypt(dek, fromB64(blob.iv), fromB64(blob.ciphertext));
  return new TextDecoder().decode(plaintext);
}
