import type { ChatController } from "../chat/chat-controller.js";

export interface AskCommandDeps {
  controller: ChatController;
  reveal: () => void;
  setInputText: (text: string) => void;
}

export function buildAskAboutSelectionPrefill(inp: {
  relativePath: string;
  startLine: number;
  endLine: number;
  languageId: string;
  selectionText: string;
}): string {
  const startHuman = inp.startLine + 1;
  const endHuman = inp.endLine + 1;
  const lineSegment =
    startHuman === endHuman ? `line ${startHuman}` : `lines ${startHuman}–${endHuman}`;
  return [
    `Context (${inp.relativePath}, ${lineSegment}):`,
    `\`\`\`${inp.languageId}`,
    inp.selectionText,
    "```",
    "",
    "Question: ",
  ].join("\n");
}

export function createAskCommand(deps: AskCommandDeps): () => Promise<void> {
  return async () => {
    deps.reveal();
  };
}

export function createAskAboutSelectionCommand(
  deps: AskCommandDeps,
  getSelection: () =>
    | {
        relativePath: string;
        startLine: number;
        endLine: number;
        languageId: string;
        selectionText: string;
      }
    | undefined,
): () => Promise<void> {
  return async () => {
    const sel = getSelection();
    if (sel === undefined) return;
    deps.reveal();
    deps.setInputText(buildAskAboutSelectionPrefill(sel));
  };
}
