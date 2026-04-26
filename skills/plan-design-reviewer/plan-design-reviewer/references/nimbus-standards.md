# Nimbus Review Standards

Evaluate all plans and designs against these non-negotiables:

1. **Local-first**: The machine is the source of truth; cloud is just a connector.
2. **HITL (Human-In-The-Loop)**: Consent gates must be structural and unbypassable for destructive or sensitive actions.
3. **No Plaintext Credentials**: Secrets must live in the Vault (DPAPI/Keychain) and never in logs, IPC, or config.
4. **Platform Equality**: Windows, macOS, and Linux must be supported equally.
5. **No `any`**: TypeScript strict mode is mandatory. Use `unknown` for external data.
6. **Architecture Integrity**: Ensure new changes don't violate package dependency rules (e.g., `gateway` should not import from `cli`).
