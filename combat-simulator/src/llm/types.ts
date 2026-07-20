export type LlmCompleteRequest = {
  purpose: "narrate" | "director_orders" | "actor_plan";
  system: string;
  user: string;
  jsonMode?: boolean;
};

export type LlmCompleteResult = {
  text: string;
  provider: "ollama" | "cursor";
  model: string;
};

export interface LlmProvider {
  readonly id: "ollama" | "cursor";
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
  healthCheck(): Promise<boolean>;
}
