export type AgentInvokeContext = {
  clientId: string;
  input: string;
  stream: boolean;
  sendChunk: (text: string) => void;
};

export type AgentInvokeHandler = (ctx: AgentInvokeContext) => Promise<{ reply: string }>;
