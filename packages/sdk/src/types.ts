/**
 * Shared types for Nimbus extensions
 */

export interface NimbusItem {
  id: string;
  service: string;
  itemType: "file" | "folder" | "email" | "event" | "photo" | "task";
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: number;
  modifiedAt?: number;
  url?: string;
  parentId?: string;
  rawMeta?: Record<string, unknown>;
}

export interface ExtensionManifest {
  $schema?: string;
  id: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  icon?: string;
  entrypoint: string;
  runtime: "bun" | "node";
  permissions: Array<"read" | "write" | "delete">;
  hitlRequired: Array<"write" | "delete">;
  oauth?: {
    provider: string;
    scopes: string[];
    authUrl: string;
    tokenUrl: string;
    pkce: boolean;
  };
  syncInterval?: number;
  tags?: string[];
  minNimbusVersion: string;
}
