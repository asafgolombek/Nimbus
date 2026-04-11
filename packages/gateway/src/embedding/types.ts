/** Row shape needed to build text for embedding (matches `item` core columns). */
export type IndexedItem = {
  id: string;
  title: string;
  body_preview: string | null;
};

export type Chunk = {
  itemId: string;
  chunkIndex: number;
  text: string;
};

export interface Embedder {
  model: string;
  dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface EmbeddingPipeline {
  embedItem(item: IndexedItem): Promise<void>;
  deleteItemEmbeddings(itemId: string): Promise<void>;
  backfillAll(onProgress?: (done: number, total: number) => void): Promise<void>;
}
