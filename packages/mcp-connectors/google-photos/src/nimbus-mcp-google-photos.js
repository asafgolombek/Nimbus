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
    id: "com.nimbus.google-photos",
    displayName: "Google Photos",
    version: "0.1.0",
    description: "Search and manage your Google Photos library from Nimbus.",
    author: "Nimbus Contributors",
    entrypoint: "dist/server.js",
    runtime: "bun",
    permissions: ["read", "delete"],
    hitlRequired: ["delete"],
    minNimbusVersion: "0.1.0"
  }
});
server.start();

//# debugId=51C32B568FF5F10964756E2164756E21
//# sourceMappingURL=nimbus-mcp-google-photos.js.map
