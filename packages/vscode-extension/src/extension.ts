/**
 * Placeholder activate/deactivate. The real wiring (ConnectionManager,
 * ChatController, status bar, HITL routing, command registration) lands
 * in PR4 (Task 26). This stub exists so esbuild can bundle the package
 * during PR3's CI before the full activation surface is implemented.
 */
import type * as vscode from "vscode";

export function activate(_ctx: vscode.ExtensionContext): void {
  // No-op. PR4 fills this in.
}

export function deactivate(): void {
  // No-op. PR4 fills this in.
}
