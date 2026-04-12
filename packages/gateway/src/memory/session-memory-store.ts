import type { Database } from "bun:sqlite";

import { readIndexedUserVersion } from "../index/migrations/runner.ts";
import { ensureSqliteVecForConnection } from "../index/sqlite-vec-load.ts";

export type SessionMemoryRole = "user" | "assistant" | "tool";

export type SessionChunk = {
  sessionId: string;
  text: string;
  role: SessionMemoryRole;
  createdAt: number;
};

export type SessionMemoryRecallHit = {
  chunkText: string;
  role: SessionMemoryRole;
  createdAt: number;
  distance: number;
};

export type SessionMemoryStoreDeps = {
  db: Database;
  /** Vector dimension (must match `vec_items_384`). */
  dims: number;
  embedText: (text: string) => Promise<Float32Array | null>;
};

/**
 * RAG session chunks in `session_memory` + shared `vec_items_384` pool (schema v10+).
 */
export class SessionMemoryStore {
  private readonly db: Database;
  private readonly dims: number;
  private readonly embedText: (text: string) => Promise<Float32Array | null>;

  constructor(deps: SessionMemoryStoreDeps) {
    this.db = deps.db;
    this.dims = deps.dims;
    this.embedText = deps.embedText;
  }

  private ensureReady(): boolean {
    const uv = readIndexedUserVersion(this.db);
    if (uv < 10) {
      return false;
    }
    return ensureSqliteVecForConnection(this.db, uv);
  }

  async append(chunk: SessionChunk): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }
    const vec = await this.embedText(chunk.text);
    if (vec?.length !== this.dims) {
      return;
    }
    const now = chunk.createdAt;
    this.db.transaction(() => {
      const maxRow = this.db
        .query(`SELECT COALESCE(MAX(rowid), 0) AS m FROM vec_items_384`)
        .get() as { m: number | bigint };
      const rowid = Number(maxRow.m) + 1;
      this.db.run(`INSERT INTO vec_items_384(rowid, embedding) VALUES (?, vec_f32(?))`, [
        BigInt(rowid),
        new Float32Array(vec),
      ]);
      this.db.run(
        `INSERT INTO session_memory (session_id, chunk_text, vec_rowid, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [chunk.sessionId, chunk.text, rowid, chunk.role, now],
      );
    })();
  }

  async recall(sessionId: string, query: string, topK = 8): Promise<SessionMemoryRecallHit[]> {
    if (!this.ensureReady()) {
      return [];
    }
    const qVec = await this.embedText(query);
    if (qVec?.length !== this.dims) {
      return [];
    }
    const k = Math.min(32, Math.max(1, Math.floor(topK)));
    const lim = Math.min(200, k * 4);
    const q = new Float32Array(qVec);
    const sql = `
      SELECT sm.chunk_text AS chunkText, sm.role AS role, sm.created_at AS createdAt, knn.distance AS distance
      FROM (
        SELECT rowid, distance FROM vec_items_384 WHERE embedding MATCH ? AND k = ?
      ) knn
      INNER JOIN session_memory sm ON sm.vec_rowid = knn.rowid
      WHERE sm.session_id = ?
      ORDER BY knn.distance
      LIMIT ?
    `;
    const rows = this.db.query(sql).all(q, lim, sessionId, k) as Array<{
      chunkText: string;
      role: string;
      createdAt: number;
      distance: number;
    }>;
    const out: SessionMemoryRecallHit[] = [];
    for (const r of rows) {
      const role = r.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") {
        continue;
      }
      out.push({
        chunkText: r.chunkText,
        role,
        createdAt: r.createdAt,
        distance: r.distance,
      });
    }
    return out;
  }

  /** Drop chunks older than `ttlMs` for every session (hourly job). */
  pruneExpired(ttlMs: number, nowMs: number): number {
    if (!this.ensureReady()) {
      return 0;
    }
    const cutoff = nowMs - ttlMs;
    const rows = this.db
      .query(`SELECT id FROM session_memory WHERE created_at < ?`)
      .all(cutoff) as { id: number }[];
    for (const r of rows) {
      this.db.run(`DELETE FROM session_memory WHERE id = ?`, [r.id]);
    }
    return rows.length;
  }

  deleteSession(sessionId: string): void {
    if (readIndexedUserVersion(this.db) < 10) {
      return;
    }
    this.db.run(`DELETE FROM session_memory WHERE session_id = ?`, [sessionId]);
  }

  listSessions(): Array<{ sessionId: string; lastWriteAt: number; chunkCount: number }> {
    if (readIndexedUserVersion(this.db) < 10) {
      return [];
    }
    return this.db
      .query(
        `SELECT session_id AS sessionId,
                MAX(created_at) AS lastWriteAt,
                COUNT(*) AS chunkCount
         FROM session_memory
         GROUP BY session_id
         ORDER BY lastWriteAt DESC
         LIMIT 500`,
      )
      .all() as Array<{ sessionId: string; lastWriteAt: number; chunkCount: number }>;
  }
}
