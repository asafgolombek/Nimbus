/**
 * Embedded Ed25519 public key for updater signature verification.
 *
 * Replaced once at the start of WS4 implementation by running:
 *   bun scripts/generate-updater-keypair.ts
 *
 * The matching private key is stored in GitHub secret `UPDATER_SIGNING_KEY`.
 *
 * Override for tests via the NIMBUS_DEV_UPDATER_PUBLIC_KEY env var.
 */
import { processEnvGet } from "../platform/env-access.ts";

export const UPDATER_PUBLIC_KEY_BASE64 = "aHCEta3sioGdbjyRtS0TdSowop//jqaBr3MqDVb7nSc=";

export function loadUpdaterPublicKey(): Uint8Array {
  const override = processEnvGet("NIMBUS_DEV_UPDATER_PUBLIC_KEY");
  const source = override ?? UPDATER_PUBLIC_KEY_BASE64;
  if (source === "<DEV-PLACEHOLDER>") {
    throw new Error(
      "updater public key is unset — run `bun scripts/generate-updater-keypair.ts` or set NIMBUS_DEV_UPDATER_PUBLIC_KEY",
    );
  }
  const bytes = Buffer.from(source, "base64");
  if (bytes.length !== 32) {
    throw new Error(`updater public key must be 32 bytes, got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}
