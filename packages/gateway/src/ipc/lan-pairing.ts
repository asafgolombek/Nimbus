import { randomBytes } from "node:crypto";
import bs58 from "bs58";

/** 120-bit entropy → 20 base58 characters. */
export function generatePairingCode(): string {
  const raw = new Uint8Array(randomBytes(15)); // 15 bytes = 120 bits
  const encoded = bs58.encode(raw);
  if (encoded.length >= 20) return encoded.slice(0, 20);
  return encoded.padStart(20, "1");
}

export class PairingWindow {
  private code: string | null = null;
  private openedAt: number | null = null;
  private now: () => number;
  constructor(
    private readonly windowMs: number,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now());
  }

  open(code: string): void {
    this.code = code;
    this.openedAt = this.now();
  }

  close(): void {
    this.code = null;
    this.openedAt = null;
  }

  isOpen(): boolean {
    if (!this.code || this.openedAt === null) return false;
    return this.now() - this.openedAt <= this.windowMs;
  }

  getExpiresAt(): number | null {
    if (this.openedAt === null) return null;
    return this.openedAt + this.windowMs;
  }

  consume(code: string): boolean {
    return this.consumeAt(code, this.now());
  }

  consumeAt(code: string, nowMs: number): boolean {
    if (!this.code || this.openedAt === null) return false;
    if (nowMs - this.openedAt > this.windowMs) {
      this.close();
      return false;
    }
    if (!timingSafeEqual(code, this.code)) return false;
    this.close();
    return true;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
