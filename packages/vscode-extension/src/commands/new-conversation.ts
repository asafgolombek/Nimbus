import type { ChatController } from "../chat/chat-controller.js";

export function createNewConversationCommand(controller: ChatController): () => Promise<void> {
  return async () => {
    await controller.newConversation();
  };
}
