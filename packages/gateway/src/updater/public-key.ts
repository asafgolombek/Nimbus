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
  if (override !== undefined) {
    if (processEnvGet("NODE_ENV") === "production") {
      throw new Error(
        "NIMBUS_DEV_UPDATER_PUBLIC_KEY is not permitted in production builds. " +
          "Remove the environment variable or use a non-production build.",
      );
    }
    const bytes = Buffer.from(override, "base64");
    if (bytes.length !== 32) {
      throw new Error(`updater public key must be 32 bytes, got ${bytes.length}`);
    }
    return new Uint8Array(bytes);
  }
  const source = UPDATER_PUBLIC_KEY_BASE64 as string;
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
