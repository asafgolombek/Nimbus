import type { EventEmitter } from "node:events";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import net from "node:net";

import type { ClientSession, SessionWrite } from "../session.ts";
import type { BunSessionData } from "./options.ts";

export function removeStaleUnixSocketIfPresent(listenPath: string): void {
  if (!existsSync(listenPath)) {
    return;
  }
  try {
    unlinkSync(listenPath);
  } catch {
    /* stale or race — bind will surface EADDRINUSE */
  }
}

export function chmodListenSocketBestEffort(listenPath: string): void {
  try {
    chmodSync(listenPath, 0o600);
  } catch {
    /* best-effort — platform-specific */
  }
}

export type AttachSessionFn = (write: SessionWrite) => ClientSession;

export type Win32ListenerHandle = {
  netServer: net.Server;
  winSockets: Set<net.Socket>;
};

function attachWin32Socket(
  attachSession: AttachSessionFn,
  winSockets: Set<net.Socket>,
  sock: net.Socket,
): void {
  winSockets.add(sock);
  const session = attachSession((line) => {
    sock.write(line);
  });
  sock.on("data", (buf: Buffer) => {
    session.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  });
  sock.on("end", () => {
    session.endInput();
  });
  sock.on("close", () => {
    winSockets.delete(sock);
    session.dispose();
  });
  sock.on("error", () => {
    winSockets.delete(sock);
    session.dispose();
  });
}

export async function startWin32NetServer(
  listenPath: string,
  attachSession: AttachSessionFn,
): Promise<Win32ListenerHandle> {
  const winSockets = new Set<net.Socket>();
  const netServer = await new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer((sock) => attachWin32Socket(attachSession, winSockets, sock));
    server.listen(listenPath, () => {
      resolve(server);
    });
    (server as unknown as EventEmitter).on("error", (err: Error) => {
      reject(err);
    });
  });
  return { netServer, winSockets };
}

export function startBunUnixListener(
  listenPath: string,
  attachSession: AttachSessionFn,
): ReturnType<typeof Bun.listen<BunSessionData>> {
  return Bun.listen<BunSessionData>({
    unix: listenPath,
    socket: {
      open(socket) {
        const session = attachSession((line) => {
          socket.write(line);
        });
        socket.data = { session };
      },
      data(socket, data: Uint8Array) {
        socket.data.session.push(data);
      },
      close(socket) {
        const s = socket.data.session;
        s.endInput();
        s.dispose();
      },
      error(socket) {
        socket.data.session?.dispose();
      },
    },
  });
}
