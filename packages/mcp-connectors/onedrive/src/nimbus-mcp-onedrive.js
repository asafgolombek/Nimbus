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
    id: "com.nimbus.onedrive",
    displayName: "OneDrive",
    version: "0.1.0",
    description: "Access and manage your OneDrive files from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "write", "delete"],
    hitlRequired: ["write", "delete"],
    minNimbusVersion: "0.1.0"
  }
});
server.start();

//# debugId=F0D033EDA932B5C464756E2164756E21
//# sourceMappingURL=nimbus-mcp-onedrive.js.map
