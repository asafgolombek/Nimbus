export function printHelp(): void {
  console.log(`Nimbus CLI — local-first gateway client

Usage:
  nimbus start              Start gateway (background)
  nimbus stop               Stop gateway
  nimbus status             Ping gateway / show uptime
  nimbus ask <query>        Natural language (requires LLM API keys on gateway host)
  nimbus vault set <k> <v>  Store a secret
  nimbus vault get <k>      Read a secret (prompts first)
  nimbus vault delete <k>    Remove a secret
  nimbus vault list [pfx]   List vault key names
  nimbus audit [--limit N]  Recent HITL audit rows
  nimbus help               Show this message
`);
}
