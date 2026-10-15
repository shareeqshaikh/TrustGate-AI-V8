import type { IAgent } from "./agent.interface.js";
import { PaymentAgent } from "./payment.agent.js";
import { EmailAgent } from "./email.agent.js";
import { SubscriptionManagerAgent } from "./subscription.agent.js";
import { ApiKeyManagerAgent } from "./api-key.agent.js";
import { RefundManagerAgent } from "./refund-manager.agent.js";
import { SecurityManagerAgent } from "./security.agent.js";

export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, IAgent> = new Map();

  private constructor() {
    // Register core agents
    this.register(new PaymentAgent());
    this.register(new EmailAgent());
    this.register(new SubscriptionManagerAgent());
    this.register(new ApiKeyManagerAgent());
    this.register(new RefundManagerAgent());
    this.register(new SecurityManagerAgent());
  }

  public static getInstance(): AgentRegistry {
    if (!this.instance) {
      this.instance = new AgentRegistry();
    }
    return this.instance;
  }

  /**
   * Register any existing or future agent.
   * Enables dynamic extension without rewriting the dashboard or manager.
   */
  public register(agent: IAgent): void {
    if (this.agents.has(agent.id)) {
      console.warn(`[AgentRegistry] Overwriting existing registered agent '${agent.id}'`);
    }
    this.agents.set(agent.id, agent);
  }

  public unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  public getAgent(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  public hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  public getAllAgents(): IAgent[] {
    return Array.from(this.agents.values());
  }
}
