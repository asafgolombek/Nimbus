/**
 * Narrow interfaces over `vscode` so source-under-test never imports `vscode` directly.
 * extension.ts is the only file that constructs real implementations from `vscode.*`.
 */

// VS Code declares Thenable as a global, but it is not in the standard TS lib.
// Define it locally so this shim has no dependency on the `vscode` module.
type Thenable<T> = PromiseLike<T>;

export interface OutputChannelHandle {
  appendLine(msg: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface StatusBarItemHandle {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  backgroundColor: { id: string } | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface WindowApi {
  createOutputChannel(name: string): OutputChannelHandle;
  createStatusBarItem(alignment: 1 | 2, priority: number): StatusBarItemHandle;
  showInformationMessage(
    msg: string,
    opts: { modal?: boolean },
    ...items: string[]
  ): Thenable<string | undefined>;
  showErrorMessage(msg: string, ...items: string[]): Thenable<string | undefined>;
  showInputBox(opts?: { prompt?: string; value?: string }): Thenable<string | undefined>;
}

export interface WorkspaceConfigSection {
  get<T>(key: string, defaultValue: T): T;
}

export interface WorkspaceApi {
  getConfiguration(section: string): WorkspaceConfigSection;
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface CommandsApi {
  executeCommand<T>(command: string, ...args: unknown[]): Thenable<T | undefined>;
}
