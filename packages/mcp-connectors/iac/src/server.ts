/**
 * nimbus-mcp-iac — Terraform / Pulumi / CloudFormation helpers. Mutations require Gateway HITL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createRegisterSimpleTool,
  createZodToolRegistrar,
  mcpJsonResult as jsonResult,
} from "../../shared/mcp-tool-kit.ts";
import { runCliOk } from "../../shared/run-cli-json.ts";

const mcp = new McpServer({ name: "nimbus-iac", version: "0.1.0" });
const reg = createZodToolRegistrar(createRegisterSimpleTool(mcp));

reg(
  "iac_terraform_plan",
  "Run terraform plan in a directory.",
  z.object({ workingDirectory: z.string().min(1) }),
  async (p) => {
    const r = await runCliOk(["terraform", "-chdir", p.workingDirectory, "plan", "-input=false"], {
      ...process.env,
    } as Record<string, string | undefined>);
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

reg(
  "iac_terraform_apply",
  "Run terraform apply. HITL.",
  z.object({ workingDirectory: z.string().min(1) }),
  async (p) => {
    const r = await runCliOk(
      ["terraform", "-chdir", p.workingDirectory, "apply", "-auto-approve", "-input=false"],
      { ...process.env } as Record<string, string | undefined>,
    );
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

reg(
  "iac_terraform_destroy",
  "Run terraform destroy. HITL.",
  z.object({ workingDirectory: z.string().min(1) }),
  async (p) => {
    const r = await runCliOk(
      ["terraform", "-chdir", p.workingDirectory, "destroy", "-auto-approve", "-input=false"],
      { ...process.env } as Record<string, string | undefined>,
    );
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

reg(
  "iac_cloudformation_deploy",
  "Deploy a CloudFormation stack via AWS CLI. HITL.",
  z.object({
    stackName: z.string().min(1),
    templateBody: z.string().min(1),
  }),
  async (p) => {
    const r = await runCliOk(
      [
        "aws",
        "cloudformation",
        "deploy",
        "--stack-name",
        p.stackName,
        "--template-body",
        p.templateBody,
        "--capabilities",
        "CAPABILITY_IAM",
      ],
      { ...process.env } as Record<string, string | undefined>,
    );
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

reg(
  "iac_pulumi_preview",
  "Run pulumi preview in a stack directory.",
  z.object({ workingDirectory: z.string().min(1) }),
  async (p) => {
    const r = await runCliOk(
      ["pulumi", "preview", "--cwd", p.workingDirectory, "--non-interactive"],
      {
        ...process.env,
      } as Record<string, string | undefined>,
    );
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

reg(
  "iac_pulumi_up",
  "Run pulumi up. HITL.",
  z.object({ workingDirectory: z.string().min(1) }),
  async (p) => {
    const r = await runCliOk(
      ["pulumi", "up", "--yes", "--cwd", p.workingDirectory, "--non-interactive"],
      { ...process.env } as Record<string, string | undefined>,
    );
    if (!r.ok) {
      throw new Error(r.message);
    }
    return jsonResult({ ok: true });
  },
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
