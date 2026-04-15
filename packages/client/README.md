# @nimbus-dev/client

MIT-licensed JSON-RPC IPC client for the Nimbus Gateway (`nimbus start`). Published to npm as **`@nimbus-dev/client`**: **`import`** loads `dist/index.js` (ESM); **`require`** loads `dist/index.cjs` (bundled CommonJS). Run `bun run build` in this package before publishing (`prepublishOnly` does this automatically).

```typescript
import { NimbusClient, IPCClient } from "@nimbus-dev/client";

const client = await NimbusClient.open({ socketPath: "/tmp/nimbus-gateway.sock" });
const out = await client.queryItems({ services: ["github"], limit: 10 });
await client.close();
```

Use `MockClient` in unit tests when no Gateway process is available.

## Publishing (maintainers)

CI publishes on push of a tag matching `client-v*` (see `.github/workflows/publish-client.yml` in the Nimbus repo). Configure a GitHub Actions secret **`NPM_TOKEN`** (npm access token with publish rights to this scope).

Example:

```bash
git tag client-v0.1.0
git push origin client-v0.1.0
```
