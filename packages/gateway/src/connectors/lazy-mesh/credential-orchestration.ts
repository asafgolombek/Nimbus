import { anyGoogleOAuthVaultPresent } from "../../auth/google-access-token.ts";
import type { ConnectorServiceId } from "../connector-catalog.ts";
import {
  type ConnectorSecretKeyOf,
  readConnectorSecret,
  type SharedOAuthProvider,
  sharedOAuthKey,
} from "../connector-vault.ts";
import {
  ensureBitbucketMcp,
  ensureCircleciMcp,
  ensureConfluenceMcp,
  ensureDiscordMcp,
  ensureGithubMcp,
  ensureGitlabMcp,
  ensureGoogleDriveMcp,
  ensureJenkinsMcp,
  ensureJiraMcp,
  ensureKubernetesMcp,
  ensureLinearMcp,
  ensureMicrosoftBundleMcp,
  ensureNotionMcp,
  ensurePagerdutyMcp,
  ensurePhase3BundleMcp,
  ensureSlackMcp,
} from "./connector-spawns.ts";
import type { MeshSpawnContext } from "./slot.ts";

// All 11 wrappers below are file-private (no `export`). Their sole caller is
// `ensureCredentialConnectorsRunning` at the bottom of this file. Adding
// `export` to anything not used externally pollutes the module surface for
// no benefit.

async function ensureIfConnectorSecretSet<S extends ConnectorServiceId>(
  ctx: MeshSpawnContext,
  serviceId: S,
  keyName: ConnectorSecretKeyOf<S>,
  run: () => Promise<void>,
): Promise<void> {
  const v = await readConnectorSecret(ctx.vault, serviceId, keyName);
  if (v !== null && v !== "") {
    await run();
  }
}

async function ensureIfProviderOAuthSet(
  ctx: MeshSpawnContext,
  provider: SharedOAuthProvider,
  run: () => Promise<void>,
): Promise<void> {
  const v = await ctx.vault.get(sharedOAuthKey(provider));
  if (v !== null && v !== "") {
    await run();
  }
}

async function ensureIfGoogleOAuthPresent(ctx: MeshSpawnContext): Promise<void> {
  if (await anyGoogleOAuthVaultPresent(ctx.vault)) {
    await ensureGoogleDriveMcp(ctx);
  }
}

async function ensureBitbucketIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const bbUser = await readConnectorSecret(ctx.vault, "bitbucket", "username");
  const bbPass = await readConnectorSecret(ctx.vault, "bitbucket", "app_password");
  if (bbUser !== null && bbUser !== "" && bbPass !== null && bbPass !== "") {
    await ensureBitbucketMcp(ctx);
  }
}

async function ensureJiraIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const jt = await readConnectorSecret(ctx.vault, "jira", "api_token");
  const je = await readConnectorSecret(ctx.vault, "jira", "email");
  const jb = await readConnectorSecret(ctx.vault, "jira", "base_url");
  if (jt !== null && jt !== "" && je !== null && je !== "" && jb !== null && jb !== "") {
    await ensureJiraMcp(ctx);
  }
}

async function ensureConfluenceIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const ct = await readConnectorSecret(ctx.vault, "confluence", "api_token");
  const ce = await readConnectorSecret(ctx.vault, "confluence", "email");
  const cb = await readConnectorSecret(ctx.vault, "confluence", "base_url");
  if (ct !== null && ct !== "" && ce !== null && ce !== "" && cb !== null && cb !== "") {
    await ensureConfluenceMcp(ctx);
  }
}

async function ensureDiscordIfOptIn(ctx: MeshSpawnContext): Promise<void> {
  const en = await readConnectorSecret(ctx.vault, "discord", "enabled");
  const tok = await readConnectorSecret(ctx.vault, "discord", "bot_token");
  if (en === "1" && tok !== null && tok !== "") {
    await ensureDiscordMcp(ctx);
  }
}

async function ensureJenkinsIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const jb = await readConnectorSecret(ctx.vault, "jenkins", "base_url");
  const ju = await readConnectorSecret(ctx.vault, "jenkins", "username");
  const jt = await readConnectorSecret(ctx.vault, "jenkins", "api_token");
  if (
    jb !== null &&
    jb.trim() !== "" &&
    ju !== null &&
    ju.trim() !== "" &&
    jt !== null &&
    jt.trim() !== ""
  ) {
    await ensureJenkinsMcp(ctx);
  }
}

async function ensureCircleciIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const t = await readConnectorSecret(ctx.vault, "circleci", "api_token");
  if (t !== null && t.trim() !== "") {
    await ensureCircleciMcp(ctx);
  }
}

async function ensurePagerdutyIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const t = await readConnectorSecret(ctx.vault, "pagerduty", "api_token");
  if (t !== null && t.trim() !== "") {
    await ensurePagerdutyMcp(ctx);
  }
}

async function ensureKubernetesIfVaultCreds(ctx: MeshSpawnContext): Promise<void> {
  const k = await readConnectorSecret(ctx.vault, "kubernetes", "kubeconfig");
  if (k !== null && k.trim() !== "") {
    await ensureKubernetesMcp(ctx);
  }
}

/** Spawns connector MCP children when matching vault keys are present (used before aggregating tools). */
export async function ensureCredentialConnectorsRunning(ctx: MeshSpawnContext): Promise<void> {
  await ensureIfGoogleOAuthPresent(ctx);
  await ensureIfProviderOAuthSet(ctx, "microsoft", () => ensureMicrosoftBundleMcp(ctx));
  await ensureIfConnectorSecretSet(ctx, "github", "pat", () => ensureGithubMcp(ctx));
  await ensureIfConnectorSecretSet(ctx, "gitlab", "pat", () => ensureGitlabMcp(ctx));
  await ensureBitbucketIfVaultCreds(ctx);
  await ensureIfConnectorSecretSet(ctx, "slack", "oauth", () => ensureSlackMcp(ctx));
  await ensureIfConnectorSecretSet(ctx, "linear", "api_key", () => ensureLinearMcp(ctx));
  await ensureJiraIfVaultCreds(ctx);
  await ensureIfConnectorSecretSet(ctx, "notion", "oauth", () => ensureNotionMcp(ctx));
  await ensureConfluenceIfVaultCreds(ctx);
  await ensureDiscordIfOptIn(ctx);
  await ensureJenkinsIfVaultCreds(ctx);
  await ensureCircleciIfVaultCreds(ctx);
  await ensurePagerdutyIfVaultCreds(ctx);
  await ensureKubernetesIfVaultCreds(ctx);
  await ensurePhase3BundleMcp(ctx);
}
