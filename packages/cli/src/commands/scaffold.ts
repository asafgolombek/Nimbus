import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXTENSION_MANIFEST_FILENAME = "nimbus-extension.json";

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
    version: "0.0.1",
    name: id,
    entry: "dist/index.js",
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
  console.log(`Scaffolded extension at ./${id}/ (${EXTENSION_MANIFEST_FILENAME})`);
}
