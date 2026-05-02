import { extensionProcessEnv } from "../../extensions/spawn-env.ts";
import type { NimbusVault } from "../../vault/nimbus-vault.ts";
import { readConnectorSecret } from "../connector-vault.ts";
import { mcpConnectorServerScript } from "./keys.ts";
import type { ServerSpec } from "./slot.ts";

export async function phase3AddAwsMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const ak = (await readConnectorSecret(vault, "aws", "access_key_id"))?.trim() ?? "";
  const sk = (await readConnectorSecret(vault, "aws", "secret_access_key"))?.trim() ?? "";
  const reg = (await readConnectorSecret(vault, "aws", "default_region"))?.trim() ?? "";
  const prof = (await readConnectorSecret(vault, "aws", "profile"))?.trim() ?? "";
  const awsOk =
    (ak !== "" && sk !== "" && (reg !== "" || prof !== "")) || (prof !== "" && ak === "");
  if (!awsOk) {
    return;
  }
  const extra: Record<string, string> = {};
  if (ak !== "") {
    extra["AWS_ACCESS_KEY_ID"] = ak;
  }
  if (sk !== "") {
    extra["AWS_SECRET_ACCESS_KEY"] = sk;
  }
  if (reg !== "") {
    extra["AWS_DEFAULT_REGION"] = reg;
  }
  if (prof !== "") {
    extra["AWS_PROFILE"] = prof;
  }
  servers["aws"] = {
    command: "bun",
    args: [mcpConnectorServerScript("aws")],
    env: extensionProcessEnv(extra),
  };
}

export async function phase3AddAzureMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const azT = (await readConnectorSecret(vault, "azure", "tenant_id"))?.trim() ?? "";
  const azC = (await readConnectorSecret(vault, "azure", "client_id"))?.trim() ?? "";
  const azS = (await readConnectorSecret(vault, "azure", "client_secret"))?.trim() ?? "";
  if (azT === "" || azC === "" || azS === "") {
    return;
  }
  servers["azure"] = {
    command: "bun",
    args: [mcpConnectorServerScript("azure")],
    env: extensionProcessEnv({
      AZURE_TENANT_ID: azT,
      AZURE_CLIENT_ID: azC,
      AZURE_CLIENT_SECRET: azS,
    }),
  };
}

export async function phase3AddGcpMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const gcpPath = (await readConnectorSecret(vault, "gcp", "credentials_json_path"))?.trim() ?? "";
  if (gcpPath === "") {
    return;
  }
  servers["gcp"] = {
    command: "bun",
    args: [mcpConnectorServerScript("gcp")],
    env: extensionProcessEnv({ GOOGLE_APPLICATION_CREDENTIALS: gcpPath }),
  };
}

export async function phase3AddIacMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const iacEn = await readConnectorSecret(vault, "iac", "enabled");
  if (iacEn !== "1") {
    return;
  }
  servers["iac"] = {
    command: "bun",
    args: [mcpConnectorServerScript("iac")],
    env: extensionProcessEnv({}),
  };
}

export async function phase3AddGrafanaMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const gfu = (await readConnectorSecret(vault, "grafana", "url"))?.trim() ?? "";
  const gtk = (await readConnectorSecret(vault, "grafana", "api_token"))?.trim() ?? "";
  if (gfu === "" || gtk === "") {
    return;
  }
  servers["grafana"] = {
    command: "bun",
    args: [mcpConnectorServerScript("grafana")],
    env: extensionProcessEnv({ GRAFANA_URL: gfu, GRAFANA_API_TOKEN: gtk }),
  };
}

export async function phase3AddSentryMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const sentTok = (await readConnectorSecret(vault, "sentry", "auth_token"))?.trim() ?? "";
  const sentOrg = (await readConnectorSecret(vault, "sentry", "org_slug"))?.trim() ?? "";
  if (sentTok === "" || sentOrg === "") {
    return;
  }
  const extra: Record<string, string> = {
    SENTRY_AUTH_TOKEN: sentTok,
    SENTRY_ORG_SLUG: sentOrg,
  };
  const surl = (await readConnectorSecret(vault, "sentry", "url"))?.trim() ?? "";
  if (surl !== "") {
    extra["SENTRY_URL"] = surl;
  }
  servers["sentry"] = {
    command: "bun",
    args: [mcpConnectorServerScript("sentry")],
    env: extensionProcessEnv(extra),
  };
}

export async function phase3AddNewrelicMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const nrKey = (await readConnectorSecret(vault, "newrelic", "api_key"))?.trim() ?? "";
  if (nrKey === "") {
    return;
  }
  servers["newrelic"] = {
    command: "bun",
    args: [mcpConnectorServerScript("newrelic")],
    env: extensionProcessEnv({ NEW_RELIC_API_KEY: nrKey }),
  };
}

export async function phase3AddDatadogMcp(
  vault: NimbusVault,
  servers: Record<string, ServerSpec>,
): Promise<void> {
  const ddKey = (await readConnectorSecret(vault, "datadog", "api_key"))?.trim() ?? "";
  const ddApp = (await readConnectorSecret(vault, "datadog", "app_key"))?.trim() ?? "";
  if (ddKey === "" || ddApp === "") {
    return;
  }
  const extra: Record<string, string> = {
    DD_API_KEY: ddKey,
    DD_APP_KEY: ddApp,
  };
  const site = (await readConnectorSecret(vault, "datadog", "site"))?.trim() ?? "";
  if (site !== "") {
    extra["DD_SITE"] = site;
  }
  servers["datadog"] = {
    command: "bun",
    args: [mcpConnectorServerScript("datadog")],
    env: extensionProcessEnv(extra),
  };
}

export async function buildPhase3Servers(vault: NimbusVault): Promise<Record<string, ServerSpec>> {
  const servers: Record<string, ServerSpec> = {};
  await phase3AddAwsMcp(vault, servers);
  await phase3AddAzureMcp(vault, servers);
  await phase3AddGcpMcp(vault, servers);
  await phase3AddIacMcp(vault, servers);
  await phase3AddGrafanaMcp(vault, servers);
  await phase3AddSentryMcp(vault, servers);
  await phase3AddNewrelicMcp(vault, servers);
  await phase3AddDatadogMcp(vault, servers);
  return servers;
}
