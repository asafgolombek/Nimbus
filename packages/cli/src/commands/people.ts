import { IPCClient } from "../ipc-client/index.ts";
import { readGatewayState } from "../lib/gateway-process.ts";
import { getCliPlatformPaths } from "../paths.ts";

type PersonJson = {
  id: string;
  displayName: string | null;
  canonicalEmail: string | null;
  githubLogin: string | null;
  gitlabLogin: string | null;
  slackHandle: string | null;
  linearMemberId: string | null;
  jiraAccountId: string | null;
  notionUserId: string | null;
  linked: boolean;
  itemCount?: number;
};

async function withIpc<T>(fn: (c: IPCClient) => Promise<T>): Promise<T> {
  const paths = getCliPlatformPaths();
  const state = await readGatewayState(paths);
  if (state === undefined) {
    throw new Error("Gateway is not running. Start with: nimbus start");
  }
  const client = new IPCClient(state.socketPath);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

function printPerson(p: PersonJson): void {
  const handles = [
    p.githubLogin !== null && p.githubLogin !== "" ? `github=${p.githubLogin}` : "",
    p.gitlabLogin !== null && p.gitlabLogin !== "" ? `gitlab=${p.gitlabLogin}` : "",
    p.slackHandle !== null && p.slackHandle !== "" ? `slack=${p.slackHandle}` : "",
    p.linearMemberId !== null && p.linearMemberId !== "" ? `linear=${p.linearMemberId}` : "",
    p.jiraAccountId !== null && p.jiraAccountId !== "" ? `jira=${p.jiraAccountId}` : "",
    p.notionUserId !== null && p.notionUserId !== "" ? `notion=${p.notionUserId}` : "",
  ].filter((s) => s !== "");
  const link = p.linked ? "linked" : "unlinked";
  const email = p.canonicalEmail ?? "—";
  const name = p.displayName ?? "—";
  const items = typeof p.itemCount === "number" ? ` items=${String(p.itemCount)}` : "";
  console.log(`${p.id}  ${link}  ${name}  ${email}${items}`);
  if (handles.length > 0) {
    console.log(`   ${handles.join("  ")}`);
  }
}

export async function runPeople(args: string[]): Promise<void> {
  const sub = args[0] ?? "help";
  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log(`nimbus people — local cross-service people graph

Usage:
  nimbus people list [--unlinked] [--limit N]
  nimbus people search <query> [--limit N]
  nimbus people get <id>
  nimbus people items <id> [--limit N]
  nimbus people link <id-a> <id-b>   Merge id-b into id-a (id-a survives)
  nimbus people help
`);
    return;
  }

  if (sub === "list") {
    let unlinkedOnly = false;
    let limit = 100;
    for (let i = 1; i < args.length; i += 1) {
      const a = args[i];
      if (a === "--unlinked") {
        unlinkedOnly = true;
      } else if (a === "--limit") {
        const limStr = args[i + 1];
        if (limStr !== undefined) {
          limit = Number.parseInt(limStr, 10);
          i += 1;
        }
      }
    }
    const rows = await withIpc((c) => c.call<PersonJson[]>("people.list", { unlinkedOnly, limit }));
    for (const p of rows) {
      printPerson(p);
    }
    return;
  }

  if (sub === "search") {
    const q = args[1];
    if (q === undefined || q === "") {
      throw new Error("Usage: nimbus people search <query> [--limit N]");
    }
    let limit = 25;
    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === "--limit") {
        const limStr = args[i + 1];
        if (limStr !== undefined) {
          limit = Number.parseInt(limStr, 10);
          i += 1;
        }
      }
    }
    const rows = await withIpc((c) => c.call<PersonJson[]>("people.search", { query: q, limit }));
    for (const p of rows) {
      printPerson(p);
    }
    return;
  }

  if (sub === "get") {
    const id = args[1];
    if (id === undefined || id === "") {
      throw new Error("Usage: nimbus people get <id>");
    }
    const p = await withIpc((c) => c.call<PersonJson | null>("people.get", { id }));
    if (p === null) {
      console.log("(not found)");
      return;
    }
    printPerson(p);
    return;
  }

  if (sub === "items") {
    const id = args[1];
    if (id === undefined || id === "") {
      throw new Error("Usage: nimbus people items <id> [--limit N]");
    }
    let limit = 50;
    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === "--limit") {
        const limStr = args[i + 1];
        if (limStr !== undefined) {
          limit = Number.parseInt(limStr, 10);
          i += 1;
        }
      }
    }
    const items = await withIpc((c) =>
      c.call<Array<{ id: string; service: string; name: string }>>("people.items", {
        personId: id,
        limit,
      }),
    );
    for (const it of items) {
      console.log(`${it.service}\t${it.id}\t${it.name}`);
    }
    return;
  }

  if (sub === "link") {
    const a = args[1];
    const b = args[2];
    if (a === undefined || b === undefined || a === "" || b === "") {
      throw new Error("Usage: nimbus people link <id-a> <id-b>");
    }
    const out = await withIpc((c) =>
      c.call<{ survivorId: string; person: PersonJson }>("people.merge", {
        personIdA: a,
        personIdB: b,
      }),
    );
    console.log(`Merged into ${out.survivorId}`);
    printPerson(out.person);
    return;
  }

  console.error(`Unknown people subcommand: ${sub}`);
  console.error("Try: nimbus people help");
  process.exitCode = 1;
}
