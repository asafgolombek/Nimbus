import type { VaultReader, VaultWriter } from "../vault/nimbus-vault.ts";
import type { ToolCredentialBinding } from "./toolgen-types.ts";

/**
 * The ONLY site that composes a `toolgen.` Vault key (static rule D29(c)).
 *
 * Per-host, NOT per-tool. Bound per-tool instead, a tool approved for hosts A and B could ask the
 * broker to hit B carrying A's credential — the tool chooses the URL, so it would be choosing the
 * recipient of the secret.
 *
 * The host is slugged (dots and dashes to underscores) because the key format is dot-delimited, and
 * an unslugged host would make `toolgen.<id>.a.b.com` ambiguous. Dashes are distinguished from dots
 * by a prefix so `a.b-c.com` and `a-b.c.com` cannot collide onto one key and share a credential.
 */
export function toolCredentialKey(toolId: string, host: string): string {
  const slug = host.toLowerCase().replaceAll("-", "_d_").replaceAll(".", "_");
  return `toolgen.${toolId}.${slug}`;
}

function parseBinding(raw: string): ToolCredentialBinding | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o["type"] === "bearer" && typeof o["token"] === "string") {
    return { type: "bearer", token: o["token"] };
  }
  if (
    o["type"] === "header" &&
    typeof o["headerName"] === "string" &&
    typeof o["value"] === "string"
  ) {
    return { type: "header", headerName: o["headerName"], value: o["value"] };
  }
  if (
    o["type"] === "basic" &&
    typeof o["username"] === "string" &&
    typeof o["password"] === "string"
  ) {
    return { type: "basic", username: o["username"], password: o["password"] };
  }
  return null;
}

/** Returns `null` for absent OR malformed — a credential we cannot parse must not half-apply. */
export async function readToolCredential(
  vault: VaultReader,
  toolId: string,
  host: string,
): Promise<ToolCredentialBinding | null> {
  const raw = await vault.get(toolCredentialKey(toolId, host));
  return raw === null ? null : parseBinding(raw);
}

export async function writeToolCredential(
  vault: VaultWriter,
  toolId: string,
  host: string,
  binding: ToolCredentialBinding,
): Promise<void> {
  await vault.set(toolCredentialKey(toolId, host), JSON.stringify(binding));
}
