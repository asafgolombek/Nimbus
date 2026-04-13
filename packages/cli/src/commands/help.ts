export function printHelp(): void {
  console.log(`Nimbus CLI — local-first gateway client

Usage:
  nimbus start              Start gateway (background)
  nimbus stop               Stop gateway
  nimbus status [--drift]   Ping gateway / uptime / embedding backfill; --drift adds IaC/AWS index hints
  nimbus search <q> …       Ranked index search (FTS + optional semantic)
  nimbus ask <query>        Natural language (requires LLM API keys on gateway host)
  nimbus vault set <k> <v>  Store a secret
  nimbus vault get <k>      Read a secret (prompts first)
  nimbus vault delete <k>    Remove a secret
  nimbus vault list [pfx]   List vault key names
  nimbus audit [--limit N]  Recent HITL audit rows
  nimbus connector …       Register connectors, OAuth, user MCP (add --mcp), sync (see: nimbus connector help)
  nimbus extension …       Install/list/enable/disable/remove local extensions (needs gateway)
  nimbus people …          Cross-service people graph (list, search, get, items, link)
  nimbus session …         Session RAG memory (list, clear, recall — needs embeddings)
  nimbus workflow …        List/save/run/delete saved workflows (agent steps)
  nimbus watch …           List/pause/resume index watchers
  nimbus repl [--session]  Interactive agent loop (TTY)
  nimbus run <file>        Save + run workflow from JSON/YAML file
  nimbus scaffold extension <id>  Minimal extension folder + manifest
  nimbus help               Show this message

Environment (optional):
  NIMBUS_GATEWAY_EXECUTABLE   Path to nimbus-gateway binary (overrides auto-detection)
  OPENAI_API_KEY              OpenAI embeddings when nimbus.toml [embedding] provider = "openai"
`);
}
