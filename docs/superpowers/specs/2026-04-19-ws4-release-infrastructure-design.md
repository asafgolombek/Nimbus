# WS 4 — Release Infrastructure Design

> **Status:** Brainstormed 2026-04-19; ready for implementation planning.
> **Predecessor:** `docs/superpowers/plans/2026-04-18-ws3-data-sovereignty.md` (merged in PR #53).
> **Phase gate:** WS4 gates the `v0.1.0` release tag. Workstreams 5–7 (Tauri UI, Rich TUI, VS Code extension) depend on the IPC surface this plan freezes.

**Goal:** Deliver the release-trust foundations for `v0.1.0` — installer-signing plumbing, end-to-end verifiable auto-update, a frozen Plugin API v1, and opt-in encrypted LAN remote access. Cert procurement and mDNS host discovery are explicitly out of scope.

## Architecture

Five loosely-coupled modules, each addable without touching the others:

1. **Signing plumbing** — CI integrates `codesign`/`signtool`/`gpg` behind secret guards. Without the secrets, steps no-op with a `"signing skipped: X_CERT not set"` log line (never fail). Real cert procurement is tracked separately and toggles the steps live when secrets appear.
2. **Auto-update core** (`packages/gateway/src/updater/`) — manifest fetcher, Ed25519 signature verifier (tweetnacl, pure JS), platform installer-invoker, rollback state machine. `updater.*` IPC methods + notifications. Update manifest hosted on GitHub Releases (`latest.json` asset). New Ed25519 keypair: public key committed to repo, private key in `UPDATER_SIGNING_KEY` GH secret.
3. **`nimbus update` CLI** (`packages/cli/src/commands/update.ts`) — thin wrapper over `updater.*` IPC. `--check`, `--yes`, default form. Startup hint printed when manifest reports newer version.
4. **Plugin API v1 freeze** (`packages/sdk/`) — freezes existing SDK exports plus two new types (`AuditLogger`, `HitlRequest`). No new manifest keys. `packages/sdk/package.json` bumps to `1.0.0` as the freeze signal. `CHANGELOG.md` documents the stable surface.
5. **LAN remote access** (`packages/gateway/src/ipc/lan-*.ts`) — NaCl box E2E encrypted (tweetnacl). V19 migration for `lan_peers`. Pairing codes 120-bit base58; brute-force guard 3 fails/60 s → 60 s lockout. `grant-write` permission flag checked inside the LAN RPC wrapper. mDNS deferred.

### Dependency graph

```
[tweetnacl dep] -> updater (Ed25519 verify)
                -> lan-crypto (NaCl box)

[release.yml]  -> signing plumbing (cert-conditional)
               -> Ed25519 signing step (real keypair, real verification)
               -> publishes latest.json to GH Releases

updater core   -> nimbus update CLI (IPC client)

Plugin API v1  -> independent of everything else in WS4
```

### Non-goals (explicitly out of scope)

- Procuring Apple Developer / Windows OV/EV certs (tracked externally; signing plumbing is cert-ready but cert-independent).
- mDNS host discovery — bundling Apple's Bonjour SDK on Windows and the avahi runtime dependency on Linux are deferred until a user hits the "my DHCP lease rotated" problem.
- New SDK exports beyond `AuditLogger` + `HitlRequest`. `NimbusTool`, `NimbusToolHandler`, `McpServerBuilder`, `ItemSchema`, `PersonSchema` are deferred until a real extension-author use case appears.
- Tauri updater integration — WS5 will wire the Tauri app to the IPC methods this plan exposes.
- `release-please` automation changes — already configured manually.
- Key rotation for the updater signing key — v2 concern. Leak response is "cut a new keypair and ship via OS package managers, bypassing the in-app updater."

### Schema migration

This plan introduces **V19** (`lan_peers` table). WS3 consumed V18.

## File Map

Grouped by module. ~52 files touched total.

### Module 1 — Signing plumbing (CI-only; no Gateway src changes)

| Action | Path | Responsibility |
|---|---|---|
| Modify | `.github/workflows/release.yml` | Replace TODO stubs with real `codesign`/`signtool`/`gpg` calls, each gated on `secrets.<CERT_VAR>` being present (no-op + log when absent) |
| Create | `scripts/sign-macos.sh` | `codesign --deep --force --options runtime` + `xcrun notarytool submit --wait` + `xcrun stapler staple` |
| Create | `scripts/sign-windows.ps1` | `signtool sign /fd SHA256 /td SHA256 /tr <timestamp-url> /f cert.pfx` |
| Create | `scripts/sign-linux-gpg.sh` | `gpg --detach-sign --armor` for `.deb` + AppImage |
| Create | `scripts/sign-ed25519.ts` | Bun script: signs each platform binary, emits per-artifact `.sig` files |
| Create | `scripts/build-update-manifest.ts` | Assembles `latest.json` from per-platform signatures + sizes + URLs |
| Create | `scripts/generate-updater-keypair.ts` | One-time keypair generator; prints `<hex-pubkey>` + `<base64-privkey>` |

### Module 2 — Auto-update core (new `updater/` dir)

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/gateway/package.json` | Add `tweetnacl` (Ed25519 + NaCl box — one dep, two modules) |
| Create | `packages/gateway/src/updater/public-key.ts` | Embedded Ed25519 public key (base64 constant); dev-key fallback gated by `NIMBUS_DEV_UPDATER_PUBLIC_KEY` env |
| Create | `packages/gateway/src/updater/types.ts` | `UpdateManifest`, `PlatformAsset`, `UpdaterState` |
| Create | `packages/gateway/src/updater/manifest-fetcher.ts` | `GET <url>` with timeout + 3xx follow + parse |
| Create | `packages/gateway/src/updater/manifest-fetcher.test.ts` | Mock HTTP; parse, error paths, timeout |
| Create | `packages/gateway/src/updater/signature-verifier.ts` | Verify Ed25519 over SHA-256 digest via tweetnacl |
| Create | `packages/gateway/src/updater/signature-verifier.test.ts` | Known-good, tampered, wrong-key, truncated-sig |
| Create | `packages/gateway/src/updater/installer.ts` | Platform dispatch: `.pkg` (macOS), NSIS silent (Windows), `.deb`/tarball (Linux) |
| Create | `packages/gateway/src/updater/installer.test.ts` | Platform dispatch correctness + backup file ordering |
| Create | `packages/gateway/src/updater/updater.ts` | State machine — `check` / `applyUpdate` / `rollback`; emits notifications |
| Create | `packages/gateway/src/updater/updater.test.ts` | State machine + verify-before-apply ordering |
| Create | `packages/gateway/src/ipc/updater-rpc.ts` | Dispatches `updater.checkNow`, `updater.applyUpdate`, `updater.rollback`, `updater.getStatus` |
| Create | `packages/gateway/src/ipc/updater-rpc.test.ts` | RPC dispatcher unit tests |
| Modify | `packages/gateway/src/ipc/server.ts` | Wire `updater.*` namespace; declare 4 new notifications in allowlist |
| Modify | `packages/gateway/src/config/nimbus-toml.ts` | `[updater]` section → `enabled`, `url`, `check_on_startup`, `auto_apply` |

### Module 3 — `nimbus update` CLI

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/cli/src/commands/update.ts` | `--check` / `--yes` / default — IPC client to `updater.*` |
| Create | `packages/cli/src/commands/update.test.ts` | CLI arg parsing + exit-code paths |
| Modify | `packages/cli/src/commands/index.ts` | Export `runUpdate` |
| Modify | `packages/cli/src/index.ts` | Register `update` subcommand |

### Module 4 — Plugin API v1 freeze

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/sdk/src/audit-logger.ts` | `AuditLogger` interface + `createScopedAuditLogger(extensionId, emit)` helper |
| Create | `packages/sdk/src/audit-logger.test.ts` | Scoping prefix enforcement; emit shape |
| Create | `packages/sdk/src/hitl-request.ts` | `HitlRequest` type definition |
| Modify | `packages/sdk/src/index.ts` | Export `AuditLogger`, `HitlRequest`, `createScopedAuditLogger` |
| Modify | `packages/sdk/src/contract-tests.ts` | v1 contract assertions — AuditLogger scopes, HitlRequest shape valid |
| Modify | `packages/sdk/src/contract-tests.test.ts` | Exercise v1 contracts |
| Create | `packages/sdk/CHANGELOG.md` | v1.0.0 entry documenting stable surface |
| Modify | `packages/sdk/package.json` | Bump version to `1.0.0` (freeze signal) |
| Create | `packages/sdk/src/plugin-api-v1.test.ts` | Imports every stable export; runs `runContractTests()` against a minimal test extension |

### Module 5 — LAN remote access

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/gateway/src/index/lan-peers-v19-sql.ts` | V19 migration — `lan_peers` table + indices |
| Modify | `packages/gateway/src/index/migrations/runner.ts` | Wire V19 step |
| Modify | `packages/gateway/src/index/local-index.ts` | `SCHEMA_VERSION = 19`; add `listLanPeers`, `addLanPeer`, `grantLanWrite`, `revokeLanPeer`, `removeLanPeer` helpers |
| Create | `packages/gateway/src/index/migrations/runner-v19.test.ts` | Migration runs idempotently |
| Create | `packages/gateway/src/ipc/lan-crypto.ts` | tweetnacl box wrapper — `generateKeypair`, `seal`, `open` |
| Create | `packages/gateway/src/ipc/lan-crypto.test.ts` | Round-trip + tamper-detection |
| Create | `packages/gateway/src/ipc/lan-pairing.ts` | 120-bit base58 pairing code generation; pairing window state |
| Create | `packages/gateway/src/ipc/lan-pairing.test.ts` | Entropy, window expiry, first-pair-closes-window |
| Create | `packages/gateway/src/ipc/lan-rate-limit.ts` | Sliding-window guard — 3 failures/60 s per source IP → 60 s lockout |
| Create | `packages/gateway/src/ipc/lan-rate-limit.test.ts` | Lockout triggers, expires, per-IP isolation |
| Create | `packages/gateway/src/ipc/lan-server.ts` | TCP listener + per-peer session + encrypted RPC multiplex |
| Create | `packages/gateway/src/ipc/lan-server.test.ts` | Server boot, accept pair, reject unknown pubkey |
| Create | `packages/gateway/src/ipc/lan-rpc.ts` | Permission wrapper — checks `lan_peer_write_allowed` + `FORBIDDEN_OVER_LAN` |
| Create | `packages/gateway/src/ipc/lan-rpc.test.ts` | Read allowed; write rejected w/o flag; forbidden-from-LAN always rejected |
| Modify | `packages/gateway/src/config/nimbus-toml.ts` | `[lan]` section → `enabled`, `port`, `bind`, `pairing_window_seconds`, `max_failed_attempts`, `lockout_seconds` |
| Modify | `packages/gateway/src/ipc/server.ts` | Boot `LanServer` when config-enabled; route LAN traffic through `lan-rpc` permission wrapper |
| Create | `packages/cli/src/commands/lan.ts` | `start [--allow-pairing]` / `stop` / `pair <host-ip> <code>` / `grant-write <peer-id>` / `revoke-write <peer-id>` / `peers` / `remove <peer-id>` |
| Create | `packages/cli/src/commands/lan.test.ts` | CLI arg parsing + IPC call shape per subcommand |
| Modify | `packages/cli/src/commands/index.ts` | Export `runLan` |
| Modify | `packages/cli/src/index.ts` | Register `lan` subcommand |
| Create | `packages/gateway/test/integration/lan/lan-rpc.test.ts` | Two in-process Gateways on loopback; pair → read → write-rejected → grant-write → write-allowed → tampered-ciphertext-rejected → window-expiry → rate-limit |

### Docs + coverage wiring

| Action | Path | Responsibility |
|---|---|---|
| Modify | `docs/phase-4-plan.md` | Status line bumped; WS4 acceptance checkboxes linked to implemented artefacts |
| Modify | `CLAUDE.md` | Key-file-locations table extended — `updater/`, `ipc/lan-*.ts` |
| Modify | `GEMINI.md` | Mirror CLAUDE.md changes |
| Modify | `packages/gateway/package.json` (coverage gate) | `test:coverage:updater` ≥ 80%, `test:coverage:lan` ≥ 80% |
| Modify | `packages/sdk/package.json` (coverage gate) | `test:coverage:sdk` ≥ 85% |
| Modify | `.github/workflows/_test-suite.yml` | Wire new coverage gates |

## IPC Surface

### Updater namespace (`updater.*`)

**Request methods:**

| Method | Params | Returns |
|---|---|---|
| `updater.checkNow` | `{}` | `{ current, latest, updateAvailable, notes? }` |
| `updater.applyUpdate` | `{}` | `{ jobId }` — progress streamed via notifications |
| `updater.rollback` | `{}` | `{ ok: true }` |
| `updater.getStatus` | `{}` | `{ state, currentVersion, configUrl, lastCheckAt? }` where `state ∈ idle \| checking \| downloading \| verifying \| applying \| rolled_back \| failed` |

**Notifications:**

| Notification | Payload | Emitted |
|---|---|---|
| `updater.updateAvailable` | `{ version, notes }` | Startup check or `checkNow` finds newer |
| `updater.downloadProgress` | `{ jobId, bytesReceived, totalBytes }` | During `applyUpdate` |
| `updater.restarting` | `{ fromVersion, toVersion }` | Just before Gateway exits |
| `updater.rolledBack` | `{ fromVersion, toVersion, reason }` | After watchdog or manual rollback |

### LAN namespace (`lan.*`) — local-socket-only

All LAN methods are callable over the Unix socket / named pipe from the CLI. **Never callable over the LAN tunnel itself** (prevents a paired peer from flipping their own write permission).

**Request methods:**

| Method | Params | Returns |
|---|---|---|
| `lan.start` | `{ allowPairing?: boolean }` | `{ listenAddr, pairingCode?, pairingExpiresAt? }` |
| `lan.stop` | `{}` | `{ ok: true }` |
| `lan.openPairingWindow` | `{}` | `{ pairingCode, expiresAt }` |
| `lan.closePairingWindow` | `{}` | `{ ok: true }` |
| `lan.pair` | `{ hostIp, pairingCode }` | `{ peerId, hostPubkey }` — client-side initiator; stores peer as outbound |
| `lan.grantWrite` | `{ peerId }` | `{ ok: true }` |
| `lan.revokeWrite` | `{ peerId }` | `{ ok: true }` |
| `lan.removePeer` | `{ peerId }` | `{ ok: true }` |
| `lan.listPeers` | `{}` | `{ peers: LanPeer[] }` — both directions |
| `lan.getStatus` | `{}` | `{ enabled, pairingWindowOpen, listenAddr?, peerCount }` |

**Notifications:**

| Notification | Payload | Emitted |
|---|---|---|
| `lan.pairingWindowOpened` | `{ pairingCode, expiresAt }` | `start --allow-pairing` or `openPairingWindow` |
| `lan.pairingWindowClosed` | `{ reason: 'expired' \| 'paired' \| 'manual' }` | Window closes |
| `lan.peerPaired` | `{ peerId, peerIp, direction }` | Successful pairing |
| `lan.peerDisconnected` | `{ peerId }` | Session ends |
| `lan.writeBlocked` | `{ peerId, method }` | Write attempted without grant |
| `lan.pairingAttemptBlocked` | `{ sourceIp, reason: 'rate_limit' \| 'no_window' }` | Brute-force or out-of-window attempt |

### Plugin API v1 — no new Gateway IPC

v1 freezes the SDK surface shape. The `AuditLogger` interface will be wired through MCP context in a later phase when an extension needs it.

### New error codes

| Code | When |
|---|---|
| `ERR_UPDATER_MANIFEST_UNREACHABLE` | `GET <url>` failed |
| `ERR_UPDATER_SIGNATURE_INVALID` | Ed25519 verification failed |
| `ERR_UPDATER_NO_UPDATE_AVAILABLE` | `applyUpdate` called when up-to-date |
| `ERR_UPDATER_ROLLBACK_FAILED` | Backup binary missing |
| `ERR_LAN_NOT_ENABLED` | LAN method called while `[lan] enabled = false` |
| `ERR_LAN_PAIRING_WINDOW_CLOSED` | `pair` attempt outside window |
| `ERR_LAN_RATE_LIMITED` | Source IP locked out |
| `ERR_LAN_WRITE_FORBIDDEN` | Peer lacks grant-write |
| `ERR_LAN_PEER_UNKNOWN` | Pubkey not in `lan_peers` |

### Tauri allowlist forward-compat

`ALLOWED_METHODS` (WS5) gains `updater.*` (all 4) and **zero LAN methods**. `vault.*` remains forbidden.

## Config Additions

Appended to `packages/gateway/src/config/nimbus-toml.ts`.

```toml
[updater]
enabled = true
# Default baked into the Gateway binary at compile time via the NIMBUS_UPDATER_URL
# build env var. The release.yml workflow injects the final URL derived from the
# GITHUB_REPOSITORY secret; users on self-hosted forks override via config or the
# NIMBUS_UPDATER_URL runtime env var.
url = "https://github.com/asafgolombek/Nimbus/releases/latest/download/latest.json"
check_on_startup = true
auto_apply = false   # reserved; always false in v1

[lan]
enabled = false
port = 7475
bind = "0.0.0.0"
pairing_window_seconds = 300
max_failed_attempts = 3
lockout_seconds = 60
```

Follows the existing per-section pattern (`nimbus-toml-llm.test.ts`, `nimbus-toml-voice.test.ts`): exported `DEFAULT_NIMBUS_UPDATER_TOML` + `DEFAULT_NIMBUS_LAN_TOML` constants, per-section parser functions, round-trip test.

**Env-var overrides:**

- `NIMBUS_UPDATER_URL` — override manifest URL
- `NIMBUS_UPDATER_DISABLE=1` — hard kill-switch
- `NIMBUS_LAN_PORT` — override port for parallel test runs
- `NIMBUS_DEV_UPDATER_PUBLIC_KEY` — dev-only public-key override (test signing flow without touching the embedded constant)

## V19 Migration — `lan_peers`

`packages/gateway/src/index/lan-peers-v19-sql.ts`:

```sql
CREATE TABLE lan_peers (
  peer_id           TEXT PRIMARY KEY,            -- base58 of SHA-256(pubkey)[:16]
  peer_pubkey       BLOB NOT NULL UNIQUE,        -- 32-byte X25519 pubkey
  direction         TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  host_ip           TEXT,                        -- last-known IP (outbound only)
  host_port         INTEGER,                     -- last-known port (outbound only)
  display_name      TEXT,                        -- user-editable label
  write_allowed     INTEGER NOT NULL DEFAULT 0,  -- 0/1 flag
  paired_at         TEXT NOT NULL,               -- ISO 8601
  last_seen_at      TEXT
);

CREATE INDEX idx_lan_peers_direction ON lan_peers(direction);
CREATE INDEX idx_lan_peers_pubkey    ON lan_peers(peer_pubkey);
```

**Invariants enforced by CHECK + application code:**

- `direction='inbound'` rows may have `write_allowed=1`; `direction='outbound'` rows MUST have `write_allowed=0` (we never flip a remote host's permissions — we control ours, they control theirs).
- `peer_pubkey` is UNIQUE — same public key cannot be both inbound and outbound.

**Migration runner wiring:** append V19 step in `packages/gateway/src/index/migrations/runner.ts` (pattern identical to V17/V18). `SCHEMA_VERSION = 19` in `local-index.ts`.

## Security Model

### Updater trust root (Ed25519)

**Keypair lifecycle:**

- Generate once at start of WS4 implementation via `bun scripts/generate-updater-keypair.ts`.
- Public key (32 bytes, base64) committed to `packages/gateway/src/updater/public-key.ts`.
- Private key stored **only** in GitHub Actions secret `UPDATER_SIGNING_KEY`.
- **No key rotation in v1.** Leak response: cut a v0.x tag from a new keypair and ship via OS package managers, bypassing the in-app updater.

**Signing (CI, `scripts/sign-ed25519.ts`):**

1. For each platform artifact: compute `sha256(binary)`.
2. Sign the 32-byte SHA-256 digest with Ed25519 → 64-byte signature.
3. Emit `<artifact>.sig` file.
4. Assemble `latest.json` with `{ version, platforms: { "<target>": { url, sha256, signature } } }`.
5. Upload all `.sig` files + `latest.json` as GitHub Release assets.

**Verification (Gateway, `signature-verifier.ts`):**

1. Fetch manifest → select platform asset → fetch binary.
2. Compute `sha256(downloaded_bytes)` — reject if mismatch with `sha256` field.
3. `nacl.sign.detached.verify(sha256_digest, signature_bytes, EMBEDDED_PUBLIC_KEY)` — reject on false.
4. Only then invoke the platform installer.
5. On any failure: delete the downloaded binary, emit `updater.rolledBack` with `reason`, write audit log entry `updater.verify_failed`.

**Dev-mode bypass:** `NIMBUS_DEV_UPDATER_PUBLIC_KEY` env var overrides the embedded constant. Used only by updater tests. Documented as test-only.

### LAN transport — NaCl box

**Keypair lifecycle:**

- Each Gateway generates a persistent X25519 keypair on first `lan.start` and stores it in the Vault under `lan.host_privkey` / `lan.host_pubkey`. Reused on subsequent boots. Rotating the keypair invalidates all paired peers (documented; out of scope for v1).

**Handshake (pair-time):**

1. Client opens TCP to `<host-ip>:7475`.
2. Client sends plaintext: `{ kind: "pair", client_pubkey, pairing_code }`.
3. Host validates pairing code in constant time, in-window, rate-limit budget available.
4. On success: host writes `lan_peers` row with `client_pubkey`, emits `lan.peerPaired`, closes the pairing window if it was one-shot. Responds with `{ kind: "pair_ok", host_pubkey }`.
5. On failure: rate-limit budget decrement, generic `pair_err` returned (never leak which check failed — prevents oracle).

**Per-message frame (post-pair):**

```
[24-byte nonce][NaCl.box-encrypted JSON body]
```

Tampered ciphertext throws on `nacl.box.open` → session terminates, `lan.peerDisconnected` emitted.

### Pairing code + brute-force guard

- **Entropy:** 120 bits → 20 base58 characters (via `crypto.getRandomValues()`).
- **Display:** Printed once by `lan.start --allow-pairing`; never stored in audit log as plaintext (only a SHA-256 digest for proof-of-issuance).
- **Rate limit:** In-memory sliding-window counter per source IP (`Map<ip, number[]>`). 3 failures within 60 s → 60 s lockout. Successful pair resets the counter for that IP. Cleared on Gateway restart (accepted tradeoff: loses short-window history to prevent lockout-DoS-by-restart).

### Audit log integration

All state-changing WS4 actions write through the existing BLAKE3-chained `audit_log`:

| Action | Context |
|---|---|
| `updater.check` | Manifest fetched |
| `updater.update_available` | Newer version detected |
| `updater.apply_start` | `applyUpdate` invoked |
| `updater.verify_failed` | Hash or signature mismatch |
| `updater.apply_success` | Installer invoked |
| `updater.rolledback` | Watchdog or manual |
| `lan.server_started` | `lan.start` |
| `lan.server_stopped` | `lan.stop` |
| `lan.pairing_window_opened` | With `expiresAt`; code NOT stored |
| `lan.peer_paired` | With `peerId` + direction |
| `lan.grant_write` | With `peerId` |
| `lan.revoke_write` | With `peerId` |
| `lan.peer_removed` | With `peerId` |
| `lan.write_blocked` | With `peerId` + method attempted |

All `action_json` payloads pass through the existing secret-scrubbing path. Pairing codes, peer private keys, and binary signatures are never logged.

### `grant-write` permission check

Single-point enforcement in `packages/gateway/src/ipc/lan-rpc.ts`:

```ts
const FORBIDDEN_OVER_LAN = new Set(["vault", "updater", "lan", "profile"]);
// Matched by namespace prefix — always rejected regardless of grant.

const WRITE_METHODS = new Set([
  "engine.ask", "engine.askStream", "connector.sync",
  "watcher.create", "watcher.update", "watcher.delete",
  "workflow.run", "workflow.create", "workflow.update", "workflow.delete",
  "extension.install", "extension.remove",
  "data.export", "data.import", "data.delete",
]);

if (isForbiddenOverLan(method)) {
  throw new LanError("ERR_METHOD_NOT_ALLOWED");
}
if (WRITE_METHODS.has(method) && !peer.write_allowed) {
  emit("lan.writeBlocked", { peerId, method });
  audit.log("lan.write_blocked", { peerId, method });
  throw new LanError("ERR_LAN_WRITE_FORBIDDEN");
}
```

### Threat model

| Threat | Mitigation |
|---|---|
| MITM on update download | Ed25519 signature over SHA-256; TLS to GH Releases is belt-and-suspenders |
| Swapped binary post-download | SHA-256 hash re-checked after disk write |
| Pairing code brute-force | 120-bit entropy + 3/60 s rate limit |
| LAN peer stealing credentials | `vault.*` forbidden over LAN |
| Paired peer elevating own permissions | `lan.*` forbidden over LAN (local-socket-only) |
| Tampered LAN ciphertext | NaCl box MAC; session drops on first failure |
| Rollback-on-failure DoS | Rollback only restores prior binary; no auto-retry loop |
| Updater private-key leak | Cut new keypair; ship new binary via OS package manager |

### Not covered (deferred)

- Update-server availability attack — DoS against GH Releases blocks updates; user unaffected until manual check.
- Peer discovery on LAN — mDNS deferred.
- Fine-grained LAN ACLs — read vs. write is the only axis in v1.
- Remote HITL attestation — LAN peer triggers a write that passes grant-write; the host's HITL dialog shows the peer ID, but there's no cryptographic attestation of which human on the peer machine initiated the request. Treated as out-of-scope (LAN peer = trusted admin).

## Testing Strategy

### Unit tests

| File | Coverage |
|---|---|
| `updater/manifest-fetcher.test.ts` | Happy-path parse; malformed JSON; timeout; 404; 500 retry (1x) |
| `updater/signature-verifier.test.ts` | Known-good sig passes; tampered payload; wrong key; truncated sig |
| `updater/installer.test.ts` | Correct platform dispatch; backup-before-exec; dry-run records without running |
| `updater/updater.test.ts` | State machine transitions; `updateAvailable` fires when newer; verify-before-apply ordering |
| `ipc/updater-rpc.test.ts` | Each method dispatch; error-code mapping |
| `ipc/lan-crypto.test.ts` | Round-trip; tamper-detection; nonce uniqueness across 10k messages |
| `ipc/lan-pairing.test.ts` | 120-bit entropy; base58 alphabet; window expiry; first-pair-closes-window |
| `ipc/lan-rate-limit.test.ts` | Lockout triggers, expires, per-IP isolation; success resets counter |
| `ipc/lan-rpc.test.ts` | Read allowed; write rejected w/o flag; forbidden-from-LAN always rejected |
| `ipc/lan-server.test.ts` | Boot/stop; accept known pubkey; reject unknown pubkey; session cleanup |
| `sdk/audit-logger.test.ts` | Scoping prefix; unscoped action rejected; async emit path |
| `cli/commands/update.test.ts` | `--check` exit codes; `--yes` suppresses prompt; download-first-then-verify |
| `cli/commands/lan.test.ts` | Each subcommand's IPC shape; error rendering |

### Migration test

`migrations/runner-v19.test.ts` — fresh DB migrates 0→19; existing V18 DB migrates 18→19 without data loss; second run is a no-op; `SCHEMA_VERSION` constant matches.

### SDK contract test

`sdk/plugin-api-v1.test.ts`:

- Imports every stable v1 export by name (compile-time check).
- Constructs a minimal test extension manifest using all v1 types.
- Calls `runContractTests()` against the test extension — must pass.
- Asserts `packages/sdk/package.json` version is `1.0.0`.
- Asserts `packages/sdk/CHANGELOG.md` exists and mentions each v1 export.

### Integration test (Gateway-level, real SQLite, real subprocesses)

`gateway/test/integration/lan/lan-rpc.test.ts`:

1. Boot Gateway A on `127.0.0.1:PORT_A` with `lan.start --allow-pairing`.
2. Boot Gateway B on `127.0.0.1:PORT_B`.
3. B runs `lan.pair` with A's IP + code → assert `peerPaired` on both sides.
4. B calls a read method (`index.search`) over LAN → asserts result.
5. B calls a write method (`engine.ask`) → asserts `ERR_LAN_WRITE_FORBIDDEN`.
6. A runs `lan.grantWrite <B's peerId>`.
7. B calls the write method again → succeeds.
8. Inject a byte flip into the ciphertext frame → assert session drops.
9. Re-establish session → still works (tamper isn't a permanent block).
10. Pairing window expiry: wait `pairing_window_seconds + 1`, new attempt → `ERR_LAN_PAIRING_WINDOW_CLOSED`.
11. Brute-force guard: 3 bad pair attempts within 60 s → 4th returns `ERR_LAN_RATE_LIMITED`.

Test uses `pairing_window_seconds=2` and `lockout_seconds=2` via env-var overrides so the suite runs in < 10 s.

### E2E CLI test

`packages/cli/test/e2e/lan.e2e.test.ts` — drives two CLI processes against two Gateway subprocesses. Validates the user-visible flow end-to-end. Uses the same shrunk timings.

### Air-gap guard test

`gateway/test/integration/updater/air-gap.test.ts` — with `config.enforce_air_gap = true`:

- `updater.checkNow` → `ERR_UPDATER_MANIFEST_UNREACHABLE` (no HTTP leaves the process).
- Startup check is a no-op — zero outbound HTTP observed.

### Signing no-op test (CI)

`.github/workflows/release.yml` gains a PR-only dry-run job running the signing scripts without real certs configured. Asserts exit 0 with `"signing skipped: X_CERT not set"` log lines. Prevents signing-script regressions on forks without secrets.

### Coverage gates

| Gate | Threshold |
|---|---|
| `test:coverage:updater` (all of `updater/`) | ≥ 80% |
| `test:coverage:lan` (all `ipc/lan-*.ts`) | ≥ 80% |
| `test:coverage:sdk` (all of `packages/sdk/src/`) | ≥ 85% |

### Manually verified (not CI-automated)

- Real signed-installer Gatekeeper pass on macOS — Apple Dev cert required.
- Real SmartScreen pass on Windows — OV cert + reputation time.
- Real `gpg --verify` on shipped `.deb` — requires published-to-keyserver public key.
- Cross-LAN two-machine pair — integration test covers loopback only.

These items are tracked in the v0.1.0 Release Gate Checklist in `docs/phase-4-plan.md` — not acceptance-blocking for this WS4 implementation plan.

## Acceptance Criteria (WS4 scope)

- [ ] `updater.updateAvailable` fires when a mock server reports a newer version; no notification when equal or older.
- [ ] `updater.applyUpdate` verifies the Ed25519 signature before invoking the installer; corrupted binary triggers rollback + `updater.rolledBack`.
- [ ] `nimbus update --check` exits `1` when an update is available; `nimbus update` downloads, verifies, then invokes the platform installer.
- [ ] Headless Gateway startup prints `"A new version of Nimbus is available..."` hint when manifest reports newer.
- [ ] `enforce_air_gap = true` → zero outbound HTTP during update check or apply.
- [ ] Plugin API v1 documented in `packages/sdk/CHANGELOG.md`; `runContractTests()` passes against a test extension using all v1 exports; `@nimbus-dev/sdk` version is `1.0.0`.
- [ ] LAN integration test passes all 11 steps (pair, read, write-rejected, grant, write-allowed, tamper, re-establish, window-expiry, rate-limit).
- [ ] `vault.*`, `updater.*`, `lan.*`, `profile.*` all rejected over LAN regardless of grant-write.
- [ ] Signing plumbing: CI dry-run asserts scripts no-op cleanly without real certs; `codesign`/`signtool`/`gpg` steps execute when their respective secrets are present.
- [ ] Coverage gates: updater ≥ 80%, LAN ≥ 80%, SDK ≥ 85%.

## Out of Scope for This Plan

- Apple Developer / Windows OV/EV cert procurement.
- mDNS host discovery.
- SDK exports beyond `AuditLogger` + `HitlRequest`.
- Tauri updater integration (WS5).
- Updater key rotation.
- Cross-machine LAN verification (integration test covers loopback only; real 2-machine LAN is in the v0.1.0 manual checklist).
