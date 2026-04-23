# Nimbus CLI Reference

Complete reference for all `nimbus` commands. For installation see [`README.md`](./README.md). For architecture context see [`architecture.md`](./architecture.md).

---

## Global Flags

These flags are accepted by every command.

| Flag | Description |
|---|---|
| `--help`, `-h` | Print command help and exit |
| `--version`, `-v` | Print Nimbus version and exit |
| `--no-color` | Disable ANSI colour output |
| `--json` | Machine-readable JSON output (where supported) |

---

## Gateway Lifecycle

### `nimbus start`

Start the Gateway as a background process and register it for autostart on login.

```bash
nimbus start
nimbus start --no-wizard        # Skip first-run onboarding hints
```

The Gateway starts in the background and listens on the platform-native IPC socket. On first start it prints next-step hints (connect a service, run `nimbus doctor`) unless `--no-wizard` is passed or the index already contains items.

The Gateway also writes **structured JSON logs** (Pino) to a daily file under your data directory’s **`logs/`** folder, named `gateway-YYYY-MM-DD.log` (same path the CLI uses when it redirects the child process). This applies whether you start via `nimbus start` or run the gateway binary directly, so logs are available even when nothing is attached to a console.

---

### `nimbus stop`

Stop the running Gateway process.

```bash
nimbus stop
```

---

### `nimbus status`

Show Gateway status and connector health.

```bash
nimbus status
nimbus status --verbose         # Per-connector item counts, p95 query latency, health lines
nimbus status --drift           # Include IaC drift hints alongside status
nimbus status --json
```

**Output includes:** Gateway PID, uptime, active profile, total indexed items, agent limits (`depth=N  tool-calls/session=N`), connector list with health state (`healthy` / `degraded` / `error` / `rate_limited` / `unauthenticated` / `paused`).

---

## Querying and Asking

### `nimbus ask`

Ask the agent a natural-language question or give it a task. The agent answers from the local index; it only calls live APIs when freshness is required. Any destructive or outgoing action requires HITL consent before it executes.

```bash
nimbus ask "Find all PDFs I received last month that I haven't opened"
nimbus ask "Which of my open PRs mention payment-service and have failing CI?"
nimbus ask "What caused the payment-service alert — what deployed recently?"
nimbus ask "Summarise everything that happened across my projects this week"
```

**Session mode:** Run `nimbus` with no arguments to open an interactive REPL. Context accumulates across turns.

```bash
nimbus                          # Opens interactive session
```

For a richer interactive experience — live connector health, sub-task progress bars, inline mid-stream HITL consent — use [`nimbus tui`](#nimbus-tui) instead.

---

### `nimbus search`

Fast structured search over the local index. Answers come from the SQLite metadata index — no cloud call is made unless `--live` is passed.

```bash
nimbus search --service google_drive --type pdf --since 30d
nimbus search --service github --type pr --state open
nimbus search --service slack --query "payment-service incident" --since 7d
nimbus search --semantic "quarterly review documents"    # Semantic/vector search
nimbus search --service linear --type issue --assignee me
```

**Options:**

| Flag | Description |
|---|---|
| `--service <name>` | Filter by connector (e.g. `github`, `google_drive`, `slack`) |
| `--type <type>` | Item type (`pr`, `issue`, `file`, `email`, `message`, `pipeline_run`, …) |
| `--since <duration>` | Time filter — e.g. `7d`, `2w`, `1m`, `2026-01-01` |
| `--until <duration>` | Upper time bound |
| `--state <state>` | Item state (e.g. `open`, `closed`, `merged`) |
| `--assignee <handle>` | Filter by assignee handle or `me` |
| `--query <text>` | Full-text search term |
| `--semantic <text>` | Vector/semantic search (uses local embedding model) |
| `--limit <n>` | Maximum results (default: 20) |
| `--json` | JSON output |

---

### `nimbus query`

Structured index query with explicit filters or raw SQL. Intended for scripting and CI pipelines.

```bash
nimbus query --service github --type pr --since 7d
nimbus query --service linear --type issue --since 14d --json
nimbus query --sql "SELECT title, url FROM items WHERE pinned = 1" --pretty
nimbus query --service pagerduty --type alert --since 1d --json | jq '.[] | .title'
```

**Options:**

| Flag | Description |
|---|---|
| `--service <name>` | Filter by connector |
| `--type <type>` | Item type |
| `--since <duration>` | Lower time bound |
| `--until <duration>` | Upper time bound |
| `--pinned` | Only pinned items |
| `--sql <query>` | Raw read-only SQL (SELECT only; DML is blocked) |
| `--pretty` | Pretty-print table output |
| `--json` | JSON array output |
| `--limit <n>` | Max rows (default: 50) |

> **Security note:** `--sql` is guarded — only `SELECT` statements are allowed. Any `INSERT`, `UPDATE`, `DELETE`, or DDL is rejected before execution.

---

### `nimbus run`

Execute a YAML script file as a single agent session. All steps use the same engine as `nimbus ask`. Steps requiring HITL are identified in a preview before any execution begins.

```bash
nimbus run ./weekly-cleanup.yml
nimbus run ./deploy.yml --no-ttv          # Dry-run / preview only, no consent prompts
```

**Script format:**

```yaml
name: weekly-cleanup
steps:
  - Find all PDF files in Google Drive not opened in 90 days
  - Summarize them by project folder
  - Move the ones from the Zurich project to /Archive/2025
  - Send me an email with the summary
```

Optional per-step metadata:

```yaml
steps:
  - prompt: Move files older than 90 days to archive
    label: archive-old-files
    continue-on-error: false
```

Scripts with only read-only steps run without a TTY (safe for CI). Scripts with HITL-required steps require an interactive terminal.

---

### `nimbus sync`

Manually trigger a sync cycle for one or all connectors.

```bash
nimbus sync all
nimbus sync github
nimbus sync google_drive
```

---

## Interactive Sessions

### `nimbus tui`

Launch the rich Ink terminal UI for interactive sessions.

```bash
nimbus tui
```

**Panes** (Option-1 "classic split" layout):

- **Query input** (top bar) — type a query; `Enter` submits.
- **Result stream** (main area) — tokens render live; scrollback preserved via Ink `<Static>` so prior output never re-renders.
- **Connector health** (right column) — polls `connector.list` every 30 s; renders `●` / `◐` / `○` glyphs for `ok` / `degraded` / `down`.
- **Watchers** (right column) — polls `watcher.list` every 30 s; shows N active, M firing, plus up to 5 firing watcher names (truncates beyond with `…N more`).
- **Sub-tasks** (right column) — event-driven via `agent.subTaskProgress`; renders a progress bar + status glyph per sub-task, truncated beyond 8 rows with `…N more (M total)`. Clears when a new query is submitted.

**Interaction:**

- `Up` / `Down` cycles history from `tui-query-history.json` (last 100 queries, dedup-on-repeat-of-last).
- `Ctrl+C` once during a stream → cancels locally with `(canceled by user — LLM may continue in the background)` line; `^C Press again within 2s to exit` hint renders for 1.5 s. Double `Ctrl+C` within 2 s → exits cleanly.
- **Mid-stream HITL:** `──[ consent required ]──` banner appears inline; prompt switches to `nimbus[hitl]>` with single-keystroke capture:
  - `a` — approve current action
  - `r` — reject current action
  - `d` — show details (no-op in v0.1.0; full payload is already shown)
  - `q` — reject all remaining actions and exit

**Automatic fallback** (invokes `nimbus repl` instead, no Ink render) when any of these hold:

- `TERM=dumb`
- `NO_COLOR` set (any value)
- stdout is not a TTY (pipe, file, non-interactive shell)
- `CI=true`
- Terminal height is below 20 rows

Fallback path prints exactly one reason (first match wins) to stderr before handing off to the REPL.

**Responsive layout:**

- Below 100 columns: collapses to a single-column layout with a compact status bar replacing the right column.
- Below 20 rows at any time: Ink unmounts cleanly with a one-line notice; relaunch after resizing.

**Gateway-offline behavior:**

- Top banner: `⚠ Gateway disconnected — reconnecting…`
- Poll panes show last-known data with a `(stale)` marker.
- Input dimmed and disabled; `Ctrl+C` still exits.
- Exponential reconnect: 2 s → 4 s → 8 s → 16 s → 30 s (repeats). Input re-enables on reconnect; `✓ Reconnected` fade confirms recovery.

**Cancel note (v0.1.0):** cancel is local-only — the Gateway has no `engine.cancelStream` handler yet, so the LLM may continue generating in the background after `Ctrl+C`. Full-fidelity cancellation is a post-v0.1.0 Gateway follow-up.

---

### `nimbus repl`

Line-based readline loop over `agent.invoke`. Always works (no Ink dependency), including SSH sessions, dumb terminals, CI, and non-TTY pipelines.

```bash
nimbus repl                      # Interactive line-based session
nimbus repl --session <id>       # Resume a saved session
```

Use this for scripts and headless environments; `nimbus tui` is the richer alternative for interactive developer sessions. `nimbus tui`'s fallback path invokes `runRepl` internally on unsuitable terminals, so you never need to choose manually — just run `nimbus tui` and let it degrade.

---

## Connectors

### `nimbus connector auth <service>`

Authenticate a service and store credentials in the OS keystore. Never stores credentials to disk or logs.

```bash
nimbus connector auth google_drive  # OAuth PKCE — opens browser
nimbus connector auth gmail
nimbus connector auth google_photos
nimbus connector auth onedrive
nimbus connector auth outlook
nimbus connector auth teams
nimbus connector auth github        # PAT prompt — stored in OS keystore
nimbus connector auth gitlab
nimbus connector auth linear
nimbus connector auth jira
nimbus connector auth slack
nimbus connector auth pagerduty
nimbus connector auth aws
nimbus connector auth azure
nimbus connector auth gcp
nimbus connector auth kubernetes
```

---

### `nimbus connector list`

List all connectors and their current health state.

```bash
nimbus connector list
nimbus connector list --json
```

**Health states:** `healthy` · `degraded` · `error` · `rate_limited` · `unauthenticated` · `paused`

---

### `nimbus connector status <name>`

Show detailed status for a single connector.

```bash
nimbus connector status github
nimbus connector status github --json
```

---

### `nimbus connector sync <name>`

Trigger an immediate sync for a connector.

```bash
nimbus connector sync github
nimbus connector sync google_drive
```

---

### `nimbus connector pause <name>` / `resume <name>`

Pause or resume sync scheduling for a connector without removing its credentials.

```bash
nimbus connector pause github
nimbus connector resume github
```

---

### `nimbus connector set-interval <name> <seconds>`

Override the sync interval for a connector.

```bash
nimbus connector set-interval github 300
```

---

### `nimbus connector history <name>`

Show the health transition history for a connector — useful for diagnosing flapping or persistent errors.

```bash
nimbus connector history github
nimbus connector history github --limit 50
nimbus connector history github --json
```

---

### `nimbus connector remove <name>`

Remove a connector: deletes all associated Vault entries and index rows atomically. Irreversible — requires confirmation.

```bash
nimbus connector remove github
nimbus connector remove github --yes    # Skip confirmation
```

---

## Configuration

### `nimbus config get <key>`

Read a single configuration value.

```bash
nimbus config get sync.intervalSeconds
nimbus config get telemetry.enabled
nimbus config get llm.provider
```

---

### `nimbus config set <key> <value>`

Set a configuration value. Changes take effect on the next Gateway restart for Gateway-owned keys; CLI-only keys take effect immediately.

```bash
nimbus config set sync.intervalSeconds 300
nimbus config set telemetry.enabled false
nimbus config set llm.provider anthropic
```

---

### `nimbus config list`

List all configuration keys with their current values, source (`file` / `env` / `default`), and documentation.

```bash
nimbus config list
nimbus config list --json
```

---

### `nimbus config validate`

Validate the current `nimbus.toml` configuration file against the schema. Exits `0` on success, `1` on error.

```bash
nimbus config validate
```

---

### `nimbus config edit`

Open `nimbus.toml` in `$EDITOR`.

```bash
nimbus config edit
```

---

### Configuration File

`nimbus.toml` lives in the platform config directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Nimbus\nimbus.toml` |
| macOS | `~/Library/Application Support/Nimbus/nimbus.toml` |
| Linux | `~/.config/nimbus/nimbus.toml` |

Key sections:

```toml
[llm]
provider = "anthropic"          # anthropic | openai
model = "claude-sonnet-4-6"

[sync]
intervalSeconds = 300
maxConcurrentSyncs = 3
retentionDays = 90
catchUpOnRestart = true

[embedding]
provider = "local"              # local | openai
# model = "all-MiniLM-L6-v2"

[telemetry]
enabled = false
endpoint = "https://telemetry.nimbus.dev/v1/collect"

[filesystem]
# roots = ["/home/user/projects", "/home/user/documents"]

[updater]
# enabled = true
# url = "https://releases.nimbus.dev/latest.json"

[lan]
# enabled = false
# port = 7475
```

**Environment variable overrides:** All keys can be overridden with `NIMBUS_` prefixed env vars. Examples: `NIMBUS_LLM_PROVIDER`, `NIMBUS_SYNC_INTERVAL_SECONDS`, `NIMBUS_TELEMETRY_ENABLED`.

---

## Profiles

Named configuration profiles let you maintain separate settings (e.g. `work` vs `personal`). Each profile has its own Vault key prefix — credentials from one profile are not accessible to another.

### `nimbus profile create <name>`

```bash
nimbus profile create work
nimbus profile create personal
```

---

### `nimbus profile list`

```bash
nimbus profile list
```

---

### `nimbus profile switch <name>`

Switch the active profile. Takes effect on the next Gateway restart.

```bash
nimbus profile switch work
nimbus profile switch personal
```

---

### `nimbus profile delete <name>`

Delete a profile and its associated configuration. Does not delete Vault entries (use `nimbus connector remove` first).

```bash
nimbus profile delete personal
```

---

## Diagnostics and Observability

### `nimbus doctor`

Run environment health checks and print actionable remediation steps. Useful as a first step when something isn't working.

```bash
nimbus doctor
```

**Checks performed:**
- Bun minimum version requirement
- Linux: `secret-tool` available (libsecret)
- Gateway IPC reachable
- Configuration file validates
- Index total item count (warns if zero — suggests connecting a service)
- Per-connector health table
- Voice (when `voice.enabled = true` in config): `whisper-cli` on PATH, `ffmpeg` on PATH, platform TTS available (`espeak-ng` on Linux, `say` on macOS, PowerShell SAPI on Windows)

**Exit codes:** `0` = all healthy, `1` = warnings, `2` = hard failures.

---

### `nimbus diag`

Capture a full diagnostic snapshot — index metrics, connector health, query latency percentiles, recent errors, system info. Safe to share with support.

```bash
nimbus diag
nimbus diag --json
```

**Output includes:** Gateway version, platform, uptime, active profile, SQLite size, item counts by service, FTS5 coverage, embedding coverage, p50/p95/p99 query latency, connector health summary, recent sync errors.

---

### `nimbus diag slow-queries`

List the slowest queries recorded in the latency ring buffer.

```bash
nimbus diag slow-queries
nimbus diag slow-queries --limit 20
nimbus diag slow-queries --since 1h
nimbus diag slow-queries --json
```

---

### `nimbus serve`

Start a read-only local HTTP API on `localhost`. Off by default. Useful for scripts, CI pipelines, and the `@nimbus-dev/client` library.

```bash
nimbus serve
nimbus serve --port 7474        # Default port: 7474
```

**Endpoints:**

| Endpoint | Description |
|---|---|
| `GET /v1/items` | List indexed items (supports `service`, `type`, `since`, `until`, `limit` query params) |
| `GET /v1/items/:id` | Get a single item by ID |
| `GET /v1/people` | List people graph entries |
| `GET /v1/people/:id` | Get a single person record |
| `GET /v1/connectors` | List connectors and health states |
| `GET /v1/audit` | Recent audit log entries |
| `GET /v1/health` | Gateway health summary |

All endpoints are `localhost`-only and read-only (`SQLITE_OPEN_READONLY` connection). There is no authentication required because the socket is owner-only at the OS level.

---

## Database

### `nimbus db verify`

Run non-destructive integrity checks on the local index. Safe to run at any time.

```bash
nimbus db verify
nimbus db verify --json
```

**Checks:** SQLite `integrity_check`, FTS5 consistency, `vec_items_384` rowid alignment, orphaned sync tokens, schema version match, foreign key integrity.

**Exit codes:** `0` = all pass, `1` = at least one finding.

---

### `nimbus db repair`

Run targeted recovery actions for any findings reported by `nimbus db verify`. Requires confirmation unless `--yes` is passed. Writes a structured repair report to the audit log.

```bash
nimbus db repair
nimbus db repair --yes          # Skip confirmation
nimbus db repair --json
```

**Repair actions:** Delete orphaned vec rows + re-queue resync, FTS5 rebuild, delete unrecoverable rows, remove orphaned sync tokens.

---

### `nimbus db snapshot`

Create a manual snapshot of the local index database.

```bash
nimbus db snapshot
nimbus db snapshot --label "before-migration"
```

Snapshots are stored under `<dataDir>/backups/`.

---

### `nimbus db restore <snapshot>`

Restore the index from a named snapshot. The Gateway must be stopped first.

```bash
nimbus stop
nimbus db restore 2026-04-15T10-30-00.snapshot
```

---

### `nimbus db snapshots list` / `nimbus db backups list`

List available snapshots and pre-migration backups.

```bash
nimbus db snapshots list
nimbus db backups list
```

---

### `nimbus db prune`

Remove old snapshots and backups beyond the configured retention window. Requires confirmation unless `--yes` is passed.

```bash
nimbus db prune
nimbus db prune --yes
```

---

## Telemetry

Telemetry is **opt-in** and **aggregate-only**. No content, query text, file names, or credentials are ever included. Disabled by default.

### `nimbus telemetry show`

Show the current telemetry configuration and a preview of the next payload.

```bash
nimbus telemetry show
```

**Payload preview includes:** `connector_error_rate`, `sync_duration_p50_ms`, `connector_health_transitions`, `extension_installs_by_id`, `cold_start_ms`, query latency percentiles. All values are aggregate counters — no content.

---

### `nimbus telemetry disable`

Disable telemetry and clear any queued payloads.

```bash
nimbus telemetry disable
```

To re-enable: `nimbus config set telemetry.enabled true`

---

## Extensions

### `nimbus extension install <path|url|package>`

Install a third-party extension. Accepts a local path, URL, or npm package name. The manifest SHA-256 is verified before installation.

```bash
nimbus extension install @community/nimbus-notion
nimbus extension install ./nimbus-my-connector
nimbus extension install https://example.com/nimbus-ext.tar.gz
```

---

### `nimbus extension list`

List installed extensions with their status (enabled / disabled).

```bash
nimbus extension list
nimbus extension list --json
```

---

### `nimbus extension enable <name>` / `disable <name>`

```bash
nimbus extension enable nimbus-notion
nimbus extension disable nimbus-notion
```

---

### `nimbus extension remove <name>`

Uninstall an extension and remove its process. Does not delete the extension's Vault entries automatically — use `nimbus connector remove` first if the extension registered connectors.

```bash
nimbus extension remove nimbus-notion
```

---

### `nimbus scaffold extension`

Scaffold a new extension package from the `@nimbus-dev/sdk` template.

```bash
nimbus scaffold extension --name my-connector --output ./nimbus-my-connector
```

---

### `nimbus test`

Run contract tests for an extension against the `@nimbus-dev/sdk` manifest contract, followed by the extension's own `bun test` suite.

```bash
nimbus test                     # In extension root directory
nimbus test ./nimbus-my-connector
```

---

## Workflows

### `nimbus workflow save <path>`

Save a YAML script as a named reusable workflow pipeline.

```bash
nimbus workflow save ./weekly-cleanup.yml --name weekly-cleanup
```

---

### `nimbus workflow list`

List saved workflow pipelines.

```bash
nimbus workflow list
```

---

### `nimbus workflow run <name>`

Run a named workflow pipeline. Same engine as `nimbus run` — two-phase preview then execution; HITL gated.

```bash
nimbus workflow run weekly-cleanup
nimbus workflow run weekly-cleanup --no-ttv     # Preview only
```

---

### `nimbus workflow delete <name>`

Delete a saved workflow pipeline.

```bash
nimbus workflow delete weekly-cleanup
```

---

## People

### `nimbus people`

Query the cross-service people graph. Resolves identities across GitHub, GitLab, Slack, Linear, Jira, Notion, and more without a network call.

```bash
nimbus people --query "elena"
nimbus people --email "elena@company.com"
nimbus people --github "elena-dev"
nimbus people --json
```

---

## Vault

### `nimbus vault list`

List Vault key names (never values). Keys are scoped per connector and per profile.

```bash
nimbus vault list
nimbus vault list --profile work
```

---

### `nimbus vault delete <key>`

Delete a specific Vault entry. Use `nimbus connector remove` for full connector cleanup.

```bash
nimbus vault delete github.pat
```

---

## Documentation

### `nimbus docs [topic]`

Open documentation for a topic in the terminal or browser.

```bash
nimbus docs
nimbus docs connectors
nimbus docs query
nimbus docs extensions
nimbus docs config
```

---

## Audit

### `nimbus audit`

Show the local audit log. Every action the agent takes — including every HITL decision — is recorded here before execution.

```bash
nimbus audit
nimbus audit --limit 100
nimbus audit --service github
nimbus audit --since 7d
nimbus audit --json
```

**Columns:** `timestamp`, `action`, `service`, `payload_summary`, `hitl_status` (`approved` / `rejected` / `not_required`), `result`.

---

## Updates

### `nimbus update`

Check for or apply a Nimbus software update. Updates are downloaded, verified against an Ed25519 signature, and then handed off to the platform installer. No update is applied until the binary signature is confirmed.

```bash
nimbus update --check               # Print current vs. latest version; exit 1 if update available, 0 if current
nimbus update                       # Download, verify signature, prompt for confirmation, run installer
nimbus update --yes                 # Skip confirmation prompt (for scripted/unattended use)
```

**Options:**

| Flag | Description |
|---|---|
| `--check` | Check-only mode — no download, no install |
| `--yes` | Skip the "Apply update?" confirmation |

**Security:** The downloaded binary's SHA-256 hash is computed and verified against the Ed25519-signed manifest before any installer is invoked. A tampered binary is rejected and automatically rolled back.

**Headless note:** When the Gateway starts in headless mode (no Tauri connection detected) and an update is available, it prints a one-line hint to stdout: `"A new version of Nimbus is available (X.Y.Z). Run 'nimbus update' to install."`

**Environment overrides:** `NIMBUS_UPDATER_URL` overrides the manifest URL. `NIMBUS_UPDATER_DISABLE=true` disables all update checks.

---

## LAN Remote Access

Encrypted, relay-free remote access between machines on the same network. Disabled by default (`[lan] enabled = false` in `nimbus.toml`). Enable via `nimbus config set lan.enabled true`.

All traffic is E2E encrypted with NaCl box (X25519 DH + XSalsa20-Poly1305). `vault.*`, `updater.*`, `lan.*`, and `profile.*` methods are forbidden over LAN regardless of peer grants.

### `nimbus lan enable`

Start the LAN server. Without `--allow-pairing`, only already-paired peers can connect.

```bash
nimbus lan enable                   # Accept connections from paired peers only
nimbus lan enable --allow-pairing   # Also open a 5-minute pairing window; prints pairing code
```

---

### `nimbus lan disable`

Stop the LAN server and close all active peer connections.

```bash
nimbus lan disable
```

---

### `nimbus lan pair <host-ip> <pairing-code>`

Initiate a key exchange with a host that has an open pairing window. Stores the peer's X25519 public key in the local `lan_peers` table.

```bash
nimbus lan pair 192.168.1.42 Ab3Xy7QmPn1Wk8Zv    # 20-character base58 pairing code
```

---

### `nimbus lan status`

Show LAN server state, listen port, and number of paired peers.

```bash
nimbus lan status
nimbus lan status --json
```

---

### `nimbus lan list-peers`

List all paired peers with their ID, direction (`inbound` / `outbound`), and write-allowed status.

```bash
nimbus lan list-peers
nimbus lan list-peers --json
```

---

### `nimbus lan grant-write <peer-id>`

Allow a peer to call write and HITL-gated methods. Read-only by default after pairing.

```bash
nimbus lan grant-write abc123
```

---

### `nimbus lan revoke-write <peer-id>`

Remove a peer's write grant. They remain paired but are restricted to read-only methods.

```bash
nimbus lan revoke-write abc123
```

---

### `nimbus lan remove-peer <peer-id>`

Unpair a peer. Their stored public key is deleted; any active session is terminated.

```bash
nimbus lan remove-peer abc123
```

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General error / warnings (e.g. `nimbus doctor` warnings, `nimbus db verify` findings) |
| `2` | Hard failure (e.g. `nimbus doctor` hard failures, Gateway unreachable) |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `NIMBUS_LLM_PROVIDER` | Override `[llm].provider` |
| `NIMBUS_LLM_MODEL` | Override `[llm].model` |
| `NIMBUS_AGENT_MODEL` | LLM model used by the agent (default: `claude-sonnet-4-6`) |
| `NIMBUS_SYNC_INTERVAL_SECONDS` | Override `[sync].intervalSeconds` |
| `NIMBUS_TELEMETRY_ENABLED` | Override `[telemetry].enabled` |
| `NIMBUS_TELEMETRY_ENDPOINT` | Override `[telemetry].endpoint` |
| `NIMBUS_DATA_DIR` | Override the platform data directory |
| `NIMBUS_CONFIG_DIR` | Override the platform config directory |
| `NIMBUS_PROFILE` | Set the active profile at launch |
| `NIMBUS_EMBEDDING_MODEL_DIR` | Path to pre-downloaded MiniLM model weights (headless bundle) |
| `NIMBUS_EMBEDDINGS` | Set to `false` to disable background embedding generation after index upserts |
| `NIMBUS_ENGINE_CONTEXT_WINDOW_ITEMS` | Top-N index items passed in full to the agent after ranked search (1–200; default 10) |
| `NIMBUS_SEARCH_PRIORITY_JSON` | Per-service search priority weights (0–1) as a JSON object e.g. `{"github":0.8,"slack":0.7}` |
| `NIMBUS_ASK_MAX_STEPS` | Mastra tool-loop depth for `nimbus ask` sessions (1–64) |
| `NIMBUS_MAX_AGENT_DEPTH` | Maximum sub-agent recursion depth for multi-agent tasks (1–10; default 3) |
| `NIMBUS_MAX_TOOL_CALLS_PER_SESSION` | Hard cap on total tool calls per session (1–200; default 20) |
| `NIMBUS_RUN_QUERY_BENCH` | Set to `1` to enable strict `< 100ms` p95 assertion in the query latency benchmark |
| `NIMBUS_LOG_LEVEL` | `debug` / `info` / `warn` / `error` (default: `info`) |
| `NIMBUS_UPDATER_URL` | Override the update manifest URL (default: official endpoint) |
| `NIMBUS_UPDATER_DISABLE` | Set to `true` to disable all auto-update checks |
| `NIMBUS_LAN_PORT` | Override the LAN TCP listen port (default: `7475`) |
| `NIMBUS_DEV_UPDATER_PUBLIC_KEY` | Override the embedded Ed25519 updater public key — for tests only |

---

## Platform Notes

| Platform | IPC Socket | Config Dir | Data Dir |
|---|---|---|---|
| Windows 10+ | `\\.\pipe\nimbus-gateway` | `%APPDATA%\Nimbus` | `%LOCALAPPDATA%\Nimbus\data` |
| macOS 13+ | `~/Library/Application Support/Nimbus/gateway.sock` | `~/Library/Application Support/Nimbus` | `~/Library/Application Support/Nimbus/data` |
| Ubuntu 22.04+ | `~/.local/share/nimbus/gateway.sock` | `~/.config/nimbus` | `~/.local/share/nimbus` |

---

## See Also

- [`README.md`](./README.md) — Quick start and overview
- [`architecture.md`](./architecture.md) — Subsystem design and data flow
- [`roadmap.md`](./roadmap.md) — Phase acceptance criteria and sequencing
- [`SECURITY.md`](./SECURITY.md) — Security model and vulnerability reporting
- [`docs/contributors/extension-author-walkthrough.md`](./contributors/extension-author-walkthrough.md) — Writing a connector extension
