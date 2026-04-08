import type { Pointer } from "bun:ffi";

/**
 * Bun FFI uses a branded `Pointer` type; OS APIs return raw addresses as numbers.
 */
export function addressAsPointer(addr: number | bigint): Pointer {
  const n = typeof addr === "bigint" ? Number(addr) : addr;
  return n as unknown as Pointer;
}
