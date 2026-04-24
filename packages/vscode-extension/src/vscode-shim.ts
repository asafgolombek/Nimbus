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
  ): Promise<string | undefined>;
  showErrorMessage(msg: string, ...items: string[]): Promise<string | undefined>;
  showInputBox(opts?: { prompt?: string; value?: string }): Promise<string | undefined>;
}

export interface WorkspaceConfigSection {
  get<T>(key: string, defaultValue: T): T;
}

export interface WorkspaceApi {
  getConfiguration(section: string): WorkspaceConfigSection;
}

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

export interface CommandsApi {
  executeCommand<T>(command: string, ...args: unknown[]): Promise<T | undefined>;
}
