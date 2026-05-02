export class RpcMethodError extends Error {
  readonly rpcCode: number;
  readonly rpcData?: Record<string, unknown>;
  constructor(rpcCode: number, message: string, rpcData?: Record<string, unknown>) {
    super(message);
    this.rpcCode = rpcCode;
    this.name = "RpcMethodError";
    if (rpcData !== undefined) {
      this.rpcData = rpcData;
    }
  }
}
