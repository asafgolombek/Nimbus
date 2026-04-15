# Nimbus

Local-first AI agent framework. **Full readme, quick start, and CLI reference:** [docs/README.md](./docs/README.md).

## Gateway from source (Sharp / embeddings)

Sharp is **not** a separate Windows installer. It comes in as an npm dependency (via **`@xenova/transformers`**) when you install the repo:

```bash
bun install
```

Run from the repository root so every workspace (including **`packages/gateway`**) gets **`node_modules`**. Then start the gateway with Bun, for example:

```bash
cd packages/gateway && bun run dev
```

If **`dist/nimbus-gateway.exe`** (or another **`bun build --compile`** binary) fails at startup with a missing **`sharp-win32-x64.node`** (or similar), that is a **compiled-binary / native-addon** limitation; use **`bun`** + **`bun install`** as above for local development.

**Linux installers (`.deb`, tarball):** They ship compiled binaries; end users do not install Sharp separately. A Sharp error in a **packaged** binary is addressed in **build/packaging**, not with `apt install sharp` on the target host.
