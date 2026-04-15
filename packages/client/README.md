# @nimbus-dev/client

MIT-licensed JSON-RPC IPC client for the Nimbus Gateway (`nimbus start`).

```typescript
import { NimbusClient, IPCClient } from "@nimbus-dev/client";

const client = await NimbusClient.open({ socketPath: "/tmp/nimbus-gateway.sock" });
const out = await client.queryItems({ services: ["github"], limit: 10 });
await client.close();
```

Use `MockClient` in unit tests when no Gateway process is available.
