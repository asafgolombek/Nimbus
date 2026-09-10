import { describe, expect, test } from "bun:test";
import { buildGeneratedManifest, emitToolScript } from "./toolgen-stub.ts";
import { BROKERED_FETCH_METHOD, ToolgenError } from "./toolgen-types.ts";

describe("buildGeneratedManifest", () => {
  test("network is EMPTY by construction", () => {
    expect(buildGeneratedManifest("tg_a").permissions.network).toEqual([]);
  });

  test("a requested network grant is REJECTED, never dropped", () => {
    expect(() => buildGeneratedManifest("tg_a", { network: ["api.example.com"] })).toThrow(
      ToolgenError,
    );
  });

  test("an empty requested grant is accepted — rejecting it would be noise", () => {
    expect(() => buildGeneratedManifest("tg_a", { network: [] })).not.toThrow();
  });

  test("filesystem write is empty and read carries the script dir", () => {
    const m = buildGeneratedManifest("tg_a", { scriptDir: "/opt/nimbus/toolgen/tg_a" });
    expect(m.permissions.filesystem.write).toEqual([]);
    expect(m.permissions.filesystem.read).toEqual(["/opt/nimbus/toolgen/tg_a"]);
  });

  test("the interpreter's read paths are granted — without them the child dies at exit 68", () => {
    const m = buildGeneratedManifest("tg_a", {
      scriptDir: "/opt/nimbus/toolgen/tg_a",
      runtimeReadPaths: ["/usr/local/bin"],
    });
    expect(m.permissions.filesystem.read).toEqual(["/opt/nimbus/toolgen/tg_a", "/usr/local/bin"]);
  });

  test("NO node_modules is ever granted — the emitted script imports nothing", () => {
    const m = buildGeneratedManifest("tg_a", { scriptDir: "/opt/nimbus/toolgen/tg_a" });
    expect(m.permissions.filesystem.read.join(" ")).not.toContain("node_modules");
  });

  test("the manifest id is namespaced so it cannot collide with a real extension", () => {
    expect(buildGeneratedManifest("tg_a").id).toBe("toolgen.tg_a");
  });
});

describe("emitToolScript", () => {
  const script = emitToolScript({
    toolId: "tg_a",
    toolName: "gitea_open_prs",
    description: "List open PRs",
    body: "return await nimbusFetch('https://api.gitea.example/prs');",
    inputSchema: { type: "object", properties: {} },
  });

  test("the emitted skeleton names the brokered method", () => {
    expect(script).toContain(BROKERED_FETCH_METHOD);
  });

  test("the model body is embedded VERBATIM", () => {
    expect(script).toContain("return await nimbusFetch('https://api.gitea.example/prs');");
  });

  test("the skeleton defines nimbusFetch so the body has a door to use", () => {
    expect(script).toContain("async function nimbusFetch");
  });

  test("the emitted script parses — a template-literal escaping bug is caught here, not at spawn", () => {
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(script)).not.toThrow();
  });

  test("emitToolScript embeds the APPROVED schema so describe() echoes the approval", () => {
    const src = emitToolScript({
      toolId: "t1",
      toolName: "generated_t1",
      description: "d",
      body: "return 1;",
      inputSchema: {
        type: "object",
        properties: { owner: { type: "string" } },
        required: ["owner"],
      },
    });
    // Embedded as a literal the same way toolName is, NOT computed at runtime: a describe() that
    // disagrees with the registry's artifact then means the on-disk script was altered.
    expect(src).toContain('"owner"');
    expect(src).toContain('"required":["owner"]');
  });
});
