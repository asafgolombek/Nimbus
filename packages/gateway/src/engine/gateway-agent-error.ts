/** Thrown when NL routing cannot reach an LLM (missing key, network, provider error). */
export class GatewayAgentUnavailableError extends Error {
  override readonly name = "GatewayAgentUnavailableError";
  constructor() {
    super("Agent unavailable — check your network connection and API key.");
  }
}
