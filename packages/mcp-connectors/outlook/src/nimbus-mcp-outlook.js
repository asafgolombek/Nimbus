// @bun
// ../../sdk/src/server.ts
class NimbusExtensionServer {
  _options;
  constructor(options) {
    this._options = options;
  }
  registerTool(_name, _definition) {}
  start() {
    this._options;
  }
}
// src/server.ts
var server = new NimbusExtensionServer({
  manifest: {
    id: "com.nimbus.outlook",
    displayName: "Outlook",
    version: "0.1.0",
    description: "Read and send Outlook email from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "write"],
    hitlRequired: ["write"],
    minNimbusVersion: "0.1.0"
  }
});
server.start();

//# debugId=A22C8200B7A2900264756E2164756E21
//# sourceMappingURL=nimbus-mcp-outlook.js.map
