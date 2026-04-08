/**
 * macOS Keychain vault — SecKeychain generic-password API via Bun FFI.
 * Listing uses a non-secret JSON index under configDir/vault (names only); the
 * OS stores encrypted secret material.
 */

import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PlatformPaths } from "../platform/paths.ts";
import { addressAsPointer } from "./ffi-ptr.ts";
import { validateVaultKeyOrThrow } from "./key-format.ts";
import type { NimbusVault } from "./nimbus-vault.ts";

const SERVICE = "dev.nimbus";
const ERR_SEC_ITEM_NOT_FOUND = -25300;

const security = dlopen("/System/Library/Frameworks/Security.framework/Security", {
  SecKeychainAddGenericPassword: {
    args: [
      FFIType.pointer,
      FFIType.uint32_t,
      FFIType.pointer,
      FFIType.uint32_t,
      FFIType.pointer,
      FFIType.uint32_t,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.int32_t,
  },
  SecKeychainFindGenericPassword: {
    args: [
      FFIType.pointer,
      FFIType.uint32_t,
      FFIType.pointer,
      FFIType.uint32_t,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.int32_t,
  },
  SecKeychainItemDelete: {
    args: [FFIType.pointer],
    returns: FFIType.int32_t,
  },
  SecKeychainItemFreeContent: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.int32_t,
  },
});

const coreFoundation = dlopen(
  "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  {
    CFRelease: {
      args: [FFIType.pointer],
      returns: FFIType.void,
    },
  },
);

export class DarwinKeychainVault implements NimbusVault {
  private readonly vaultDir: string;
  private readonly indexPath: string;

  constructor(paths: PlatformPaths) {
    this.vaultDir = join(paths.configDir, "vault");
    this.indexPath = join(this.vaultDir, ".keyindex.json");
  }

  private async readIndex(): Promise<string[]> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const keys: string[] = [];
      for (const x of parsed) {
        if (typeof x === "string") {
          keys.push(x);
        }
      }
      return keys.sort();
    } catch {
      return [];
    }
  }

  private async writeIndex(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)].sort();
    await writeFile(this.indexPath, `${JSON.stringify(unique)}\n`, "utf8");
  }

  private async removeFromIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    await this.writeIndex(keys.filter((k) => k !== key));
  }

  private async addToIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    if (!keys.includes(key)) {
      keys.push(key);
    }
    await this.writeIndex(keys);
  }

  /** Delete keychain item if present; ignores not-found. */
  private async deleteKeychainOnly(key: string): Promise<void> {
    const svcBuf = Buffer.from(SERVICE);
    const keyBuf = Buffer.from(key, "utf8");
    const passwordLengthBuf = Buffer.alloc(4);
    const passwordDataOutBuf = Buffer.alloc(8);
    const itemRefBuf = Buffer.alloc(8);
    passwordDataOutBuf.fill(0);
    itemRefBuf.fill(0);

    const status = security.symbols.SecKeychainFindGenericPassword(
      null,
      svcBuf.length,
      ptr(svcBuf),
      keyBuf.length,
      ptr(keyBuf),
      ptr(passwordLengthBuf),
      ptr(passwordDataOutBuf),
      ptr(itemRefBuf),
    );

    if (status === ERR_SEC_ITEM_NOT_FOUND) {
      return;
    }
    if (status !== 0) {
      throw new Error("Vault delete lookup failed");
    }

    const pwdLen = passwordLengthBuf.readUInt32LE(0);
    const pwdPtr = passwordDataOutBuf.readBigUInt64LE(0);
    const itemRef = itemRefBuf.readBigUInt64LE(0);

    try {
      if (pwdLen > 0 && pwdPtr !== 0n) {
        security.symbols.SecKeychainItemFreeContent(null, addressAsPointer(pwdPtr));
      }
      if (itemRef !== 0n) {
        const delStatus = security.symbols.SecKeychainItemDelete(addressAsPointer(itemRef));
        if (delStatus !== 0) {
          throw new Error("Vault delete failed");
        }
        coreFoundation.symbols.CFRelease(addressAsPointer(itemRef));
      }
    } catch (err) {
      if (itemRef !== 0n) {
        try {
          coreFoundation.symbols.CFRelease(addressAsPointer(itemRef));
        } catch {
          /* best-effort */
        }
      }
      throw err;
    }
  }

  async set(key: string, value: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    await this.deleteKeychainOnly(key);

    const svcBuf = Buffer.from(SERVICE);
    const keyBuf = Buffer.from(key, "utf8");
    const pass = Buffer.from(value, "utf8");
    const status = security.symbols.SecKeychainAddGenericPassword(
      null,
      svcBuf.length,
      ptr(svcBuf),
      keyBuf.length,
      ptr(keyBuf),
      pass.length,
      ptr(pass),
      null,
    );
    if (status !== 0) {
      throw new Error("Vault store failed");
    }
    await this.addToIndex(key);
  }

  async get(key: string): Promise<string | null> {
    validateVaultKeyOrThrow(key);
    const svcBuf = Buffer.from(SERVICE);
    const keyBuf = Buffer.from(key, "utf8");
    const passwordLengthBuf = Buffer.alloc(4);
    const passwordDataOutBuf = Buffer.alloc(8);
    const itemRefBuf = Buffer.alloc(8);
    passwordDataOutBuf.fill(0);
    itemRefBuf.fill(0);

    const status = security.symbols.SecKeychainFindGenericPassword(
      null,
      svcBuf.length,
      ptr(svcBuf),
      keyBuf.length,
      ptr(keyBuf),
      ptr(passwordLengthBuf),
      ptr(passwordDataOutBuf),
      ptr(itemRefBuf),
    );

    if (status === ERR_SEC_ITEM_NOT_FOUND) {
      return null;
    }
    if (status !== 0) {
      throw new Error("Vault read failed");
    }

    const pwdLen = passwordLengthBuf.readUInt32LE(0);
    const pwdPtr = passwordDataOutBuf.readBigUInt64LE(0);
    const itemRef = itemRefBuf.readBigUInt64LE(0);

    let plain: string;
    try {
      if (pwdLen === 0 || pwdPtr === 0n) {
        plain = "";
      } else {
        plain = Buffer.from(toArrayBuffer(addressAsPointer(pwdPtr), 0, pwdLen)).toString("utf8");
      }
      if (pwdPtr !== 0n) {
        security.symbols.SecKeychainItemFreeContent(null, addressAsPointer(pwdPtr));
      }
      if (itemRef !== 0n) {
        coreFoundation.symbols.CFRelease(addressAsPointer(itemRef));
      }
    } catch (err) {
      if (pwdPtr !== 0n) {
        try {
          security.symbols.SecKeychainItemFreeContent(null, addressAsPointer(pwdPtr));
        } catch {
          /* best-effort */
        }
      }
      if (itemRef !== 0n) {
        try {
          coreFoundation.symbols.CFRelease(addressAsPointer(itemRef));
        } catch {
          /* best-effort */
        }
      }
      throw err;
    }

    return plain;
  }

  async delete(key: string): Promise<void> {
    validateVaultKeyOrThrow(key);
    await this.deleteKeychainOnly(key);
    await this.removeFromIndex(key);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    const keys = await this.readIndex();
    if (prefix === undefined || prefix.length === 0) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(prefix));
  }
}
