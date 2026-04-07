// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// packages/gateway/src/platform/win32.ts
var exports_win32 = {};
__export(exports_win32, {
  create: () => create
});
async function create() {
  return {};
}

// packages/gateway/src/platform/darwin.ts
var exports_darwin = {};
__export(exports_darwin, {
  create: () => create2
});
async function create2() {
  return {};
}

// packages/gateway/src/platform/linux.ts
var exports_linux = {};
__export(exports_linux, {
  create: () => create3
});
async function create3() {
  return {};
}

// packages/gateway/src/platform/index.ts
import { platform } from "os";
async function createPlatformServices() {
  switch (platform()) {
    case "win32":
      return (await Promise.resolve().then(() => exports_win32)).create();
    case "darwin":
      return (await Promise.resolve().then(() => exports_darwin)).create();
    case "linux":
      return (await Promise.resolve().then(() => exports_linux)).create();
    default:
      throw new Error(`Unsupported platform: ${platform()}`);
  }
}

// packages/gateway/src/index.ts
async function main() {
  await createPlatformServices();
  process.stdout.write(`Nimbus Gateway starting...
`);
}
main().catch((err) => {
  console.error("Gateway startup failed:", err);
  process.exit(1);
});

//# debugId=19A3377D57B3382D64756E2164756E21
//# sourceMappingURL=nimbus-gateway.js.map
