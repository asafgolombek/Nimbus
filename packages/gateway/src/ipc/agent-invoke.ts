export type AgentInvokeContext = {
  clientId: string;
  input: string;
  stream: boolean;
  sendChunk: (text: string) => void;
  /** When set, session memory tools and RAG recall are scoped to this id. */
  sessionId?: string;
};

export type AgentInvokeHandler = (ctx: AgentInvokeContext) => Promise<{ reply: string }>;
