import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BackupManifest, verifyManifest } from "../db/backup-manifest.ts";
import { decryptVaultManifest, type VaultManifestBlob } from "../db/data-vault-crypto.ts";
import { unpackBundle } from "../db/tar-bundle.ts";
import type { LocalIndex } from "../index/local-index.ts";
import type { NimbusVault } from "../vault/nimbus-vault.ts";

export type RunDataImportInput = {
  bundlePath: string;
  passphrase?: string;
  recoverySeed?: string;
  vault: NimbusVault;
  index: LocalIndex;
  /** Internal test hook: throw after vault restore to exercise rollback. */
  injectFailureAfterVault?: boolean;
};

export type RunDataImportResult = {
  credentialsRestored: number;
  oauthEntriesFlagged: number;
};

type VaultEntry = { key: string; value: string };

export async function runDataImport(input: RunDataImportInput): Promise<RunDataImportResult> {
  const stage = mkdtempSync(join(tmpdir(), "nimbus-import-stage-"));
  await unpackBundle(input.bundlePath, stage);

  const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8")) as BackupManifest;
  const files: Record<string, string> = Object.fromEntries(
    Object.keys(manifest.hashes).map((name) => [name, join(stage, name)]),
  );
  const verify = await verifyManifest(manifest, files);
  if (!verify.ok) {
    throw new Error(`bundle integrity check failed at ${verify.firstMismatch ?? "unknown"}`);
  }

  const encrypted = JSON.parse(
    readFileSync(join(stage, "vault-manifest.json.enc"), "utf8"),
  ) as VaultManifestBlob;
  const plaintext = await decryptVaultManifest(encrypted, {
    ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {}),
    ...(input.recoverySeed !== undefined ? { seed: input.recoverySeed } : {}),
  });
  const entries = JSON.parse(plaintext) as VaultEntry[];

  const writtenKeys: string[] = [];
  let oauthFlagged = 0;
  try {
    for (const e of entries) {
      await input.vault.set(e.key, e.value);
      writtenKeys.push(e.key);
      if (e.key.endsWith(".oauth") || e.key.includes(".oauth.")) oauthFlagged += 1;
    }
    if (input.injectFailureAfterVault === true) {
      throw new Error("injected failure");
    }
    // TODO (integration): restore index/watcher/workflow/extension/profile payloads.
  } catch (err) {
    for (const key of writtenKeys) {
      await input.vault.delete(key).catch(() => {});
    }
    throw err;
  }

  return { credentialsRestored: writtenKeys.length, oauthEntriesFlagged: oauthFlagged };
}
