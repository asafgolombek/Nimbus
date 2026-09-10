import type { VaultDeleter, VaultReader, VaultWriter } from "../vault/nimbus-vault.ts";
import type { ToolCredentialBinding } from "./toolgen-types.ts";

/**
 * The ONLY site that composes a `toolgen.` Vault key (static rule D29(c)).
 *
 * Per-host, NOT per-tool. Bound per-tool instead, a tool approved for hosts A and B could ask the
 * broker to hit B carrying A's credential — the tool chooses the URL, so it would be choosing the
 * recipient of the secret.
 *
 * The host is slugged because the key format is dot-delimited, and an unslugged host would make
 * `toolgen.<id>.a.b.com` ambiguous. This is an ESCAPE scheme, not a blind character substitution:
 * `_` is escaped to `_u` FIRST, before `-` becomes `_d` and `.` becomes `_p` — escaping the escape
 * character first is what makes the whole scheme injective. Doing it in any other order (or
 * escaping `-`/`.` to a suffix built from characters the OTHER replacement also produces, e.g. the
 * former `_d_`/`_` pair) lets two different hosts collide onto one slug: `api.d.example.com` and
 * `api-example.com` both produced `api_d_example_com` under a `-`→`_d_`, `.`→`_` scheme, because
 * the literal text `.d.` and the escaped `-` were indistinguishable after the fact. Two hosts
 * sharing one key would defeat the per-host binding this store exists for.
 */
export function toolCredentialKey(toolId: string, host: string): string {
  const slug = host.toLowerCase().replaceAll("_", "_u").replaceAll("-", "_d").replaceAll(".", "_p");
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

/**
 * Undo `writeToolCredential` for one host. Called by `revokeCredentials` (`toolgen-gate.ts`) on a
 * toolId that will never register — an owner denial, or a failure between approval and
 * `registry.register` — so the Vault entry does not outlive a toolId nothing will ever call
 * again. MUST tolerate an absent key: `revokeCredentials` is called unconditionally once
 * `bindCredentials` has run, even for a host that never actually got a binding written.
 */
export async function deleteToolCredential(
  vault: VaultDeleter,
  toolId: string,
  host: string,
): Promise<void> {
  await vault.delete(toolCredentialKey(toolId, host));
}
