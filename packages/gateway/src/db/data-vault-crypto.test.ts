import { describe, expect, test } from "bun:test";
import { decryptVaultManifest, encryptVaultManifest } from "./data-vault-crypto.ts";

const PLAINTEXT = '[{"key":"github.pat","value":"secret_value_xyz"}]';
const PASSPHRASE = "correct horse battery staple";
const SEED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Argon2id with 64 MB memory is slow in Bun. We override to tiny parameters for tests.
const FAST_KDF = { t: 1, m: 1024, p: 1 } as const;

describe("envelope encryption", () => {
  test("round-trips plaintext via passphrase", async () => {
    const blob = await encryptVaultManifest({
      plaintext: PLAINTEXT,
      passphrase: PASSPHRASE,
      seed: SEED,
      kdfParams: FAST_KDF,
    });
    const out = await decryptVaultManifest(blob, { passphrase: PASSPHRASE });
    expect(out).toBe(PLAINTEXT);
  });

  test("round-trips plaintext via seed", async () => {
    const blob = await encryptVaultManifest({
      plaintext: PLAINTEXT,
      passphrase: PASSPHRASE,
      seed: SEED,
      kdfParams: FAST_KDF,
    });
    const out = await decryptVaultManifest(blob, { seed: SEED });
    expect(out).toBe(PLAINTEXT);
  });

  test("wrong passphrase fails to decrypt", async () => {
    const blob = await encryptVaultManifest({
      plaintext: PLAINTEXT,
      passphrase: PASSPHRASE,
      seed: SEED,
      kdfParams: FAST_KDF,
    });
    await expect(decryptVaultManifest(blob, { passphrase: "wrong" })).rejects.toThrow();
  });

  test("tampered ciphertext is rejected by AES-GCM auth tag", async () => {
    const blob = await encryptVaultManifest({
      plaintext: PLAINTEXT,
      passphrase: PASSPHRASE,
      seed: SEED,
      kdfParams: FAST_KDF,
    });
    const tampered = {
      ...blob,
      ciphertext: blob.ciphertext.replace(/^./, (c) => (c === "a" ? "b" : "a")),
    };
    await expect(decryptVaultManifest(tampered, { passphrase: PASSPHRASE })).rejects.toThrow();
  });
});
