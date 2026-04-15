import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Phase 3 §2.1 canonical manifest name; gateway also accepts legacy nimbus-extension.json. */
const EXTENSION_MANIFEST_FILENAME = "nimbus.extension.json";

export async function runScaffold(args: string[]): Promise<void> {
  const kind = args[0]?.trim() ?? "";
  if (kind !== "extension") {
    throw new Error("Usage: nimbus scaffold extension <id>");
  }
  const id = args[1]?.trim() ?? "";
  if (id === "") {
    throw new Error("Usage: nimbus scaffold extension <id>");
  }

  const dir = join(process.cwd(), id);
  mkdirSync(join(dir, "dist"), { recursive: true });

  const manifest = {
    id,
    displayName: id,
    version: "0.0.1",
    description: "Scaffolded Nimbus extension",
    author: "local",
    entrypoint: "dist/index.js",
    runtime: "bun" as const,
    permissions: ["read" as const],
    hitlRequired: [] as const,
    minNimbusVersion: "0.1.0",
  };
  writeFileSync(
    join(dir, EXTENSION_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "dist", "index.js"),
    "// Nimbus extension entry (MCP server wiring goes here)\nexport default {};\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: `nimbus-extension-${id.replaceAll(/[^a-z0-9-]/gi, "-")}`,
        private: true,
        type: "module",
        scripts: { test: "bun test" },
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "smoke.test.ts"),
    `import { describe, expect, test } from "bun:test";

describe("extension smoke", () => {
  test("loads", () => {
    expect(1).toBe(1);
  });
});
`,
    "utf8",
  );
  console.log(`Scaffolded extension at ./${id}/ (${EXTENSION_MANIFEST_FILENAME})`);
}
