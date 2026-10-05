import { Http, type HttpOptions } from "./http.js";
import { signOrder, type OrderIntent, type SignedOrder } from "./orders.js";
import type { Signer } from "./signer.js";
import type {
  Address,
  Agent,
  Credits,
  DecisionMode,
  ExecutionMode,
  Instance,
  InstanceMarket,
  LoginChallenge,
  MarketSettings,
  Order,
  PaperStatement,
  Position,
  PositionStatus,
  Session,
} from "./types.js";

export interface BotsClientOptions extends HttpOptions {
  /** Chain the signed orders are meant for. See `CHAIN_ID`. */
  chainId: number;
  /** A session token obtained earlier, to skip `login`. */
  token?: string;
}

export interface MarketConfig {
  decision: DecisionMode;
  /** Defaults to true. */
  enabled?: boolean;
  /** Omitted fields fall back to the API defaults — this is a full replacement. */
  settings?: Partial<MarketSettings>;
}

/**
 * Client for the bots API.
 *
 * Two kinds of caller use it:
 * - the **owner** of an instance logs in with their wallet ({@link login}) and
 *   manages it: markets, mode, agent, reads;
 * - an **agent** needs no session: it signs orders with its delegated key and
 *   sends them with {@link placeOrder}.
 */
export class BotsClient {
  private readonly http: Http;
  private token: string | undefined;
  readonly chainId: number;

  constructor(options: BotsClientOptions) {
    this.http = new Http(options);
    this.chainId = options.chainId;
    this.token = options.token;
  }

  // ── session ───────────────────────────────────────────────────────────────

  /** First step of the login: the text the wallet must sign. */
  requestLoginChallenge(address: Address): Promise<LoginChallenge> {
    return this.http.request<LoginChallenge>("/auth/nonce", { method: "POST", body: { address } });
  }

  /**
   * Logs in by signing a one-time message with the wallet. The session is kept
   * in this client; the returned token can be stored and reused through the
   * `token` option until `expires_at`.
   */
  async login(signer: Signer): Promise<Session> {
    const challenge = await this.requestLoginChallenge(signer.address);
    const signature = await signer.signMessage(challenge.message);
    const session = await this.http.request<Session>("/auth/verify", {
      method: "POST",
      body: { address: signer.address, signature },
    });
    this.token = session.token;
    return session;
  }

  /** Uses a session token obtained earlier. */
  setSession(token: string | undefined): void {
    this.token = token;
  }

  get isLoggedIn(): boolean {
    return this.token !== undefined;
  }

  // ── instances (owner session) ─────────────────────────────────────────────

  async listInstances(): Promise<Instance[]> {
    const { instances } = await this.authed<{ instances: Instance[] }>("/instances");
    return instances;
  }

  getInstance(tokenId: number): Promise<Instance> {
    return this.authed<Instance>(`/instances/${tokenId}`);
  }

  /** Switches between test mode (`paper`) and real execution (`live`). */
  setExecution(tokenId: number, execution: ExecutionMode): Promise<Instance> {
    return this.authed<Instance>(`/instances/${tokenId}/execution`, { method: "PATCH", body: { execution } });
  }

  async listMarkets(tokenId: number): Promise<InstanceMarket[]> {
    const { markets } = await this.authed<{ markets: InstanceMarket[] }>(`/instances/${tokenId}/markets`);
    return markets;
  }

  /** Enables, disables or reconfigures a market of the instance. */
  configureMarket(tokenId: number, marketId: string, config: MarketConfig): Promise<InstanceMarket> {
    return this.authed<InstanceMarket>(`/instances/${tokenId}/markets/${marketId}`, { method: "PUT", body: config });
  }

  async listPositions(
    tokenId: number,
    filter: { status?: PositionStatus; limit?: number } = {},
  ): Promise<Position[]> {
    const { positions } = await this.authed<{ positions: Position[] }>(`/instances/${tokenId}/positions`, {
      query: { status: filter.status, limit: filter.limit },
    });
    return positions;
  }

  getCredits(tokenId: number): Promise<Credits> {
    return this.authed<Credits>(`/instances/${tokenId}/credits`);
  }

  /** Test-mode statement: simulated profit minus execution costs and AI credits. */
  getStatement(tokenId: number): Promise<PaperStatement> {
    return this.authed<PaperStatement>(`/instances/${tokenId}/statement`);
  }

  // ── agent key (owner session) ─────────────────────────────────────────────

  /**
   * Authorizes `address` to send orders for the instance until `expiresAt`
   * (at most 90 days ahead). The agent key only signs orders: it can never
   * move funds or change the configuration.
   */
  setAgent(tokenId: number, address: Address, expiresAt: Date): Promise<Agent> {
    return this.authed<Agent>(`/instances/${tokenId}/agent`, {
      method: "PUT",
      body: { address, expires_at: expiresAt.toISOString() },
    });
  }

  /** Revokes the agent key immediately. */
  async revokeAgent(tokenId: number): Promise<void> {
    await this.authed<void>(`/instances/${tokenId}/agent`, { method: "DELETE" });
  }

  // ── orders ────────────────────────────────────────────────────────────────

  /**
   * Signs and sends an order. No session is needed: the signature of the owner
   * or of the delegated agent is the authentication.
   *
   * The order is accepted as `pending` and executed by the engine within its
   * next cycle; poll {@link getOrder} for the outcome. Only markets configured
   * with `decision: "external"` accept orders.
   */
  async placeOrder(signer: Signer, intent: OrderIntent): Promise<Order> {
    return this.submitOrder(await signOrder(signer, this.chainId, intent));
  }

  /** Sends an order that was signed elsewhere. */
  submitOrder(order: SignedOrder): Promise<Order> {
    return this.http.request<Order>(`/instances/${order.tokenId}/orders`, {
      method: "POST",
      body: {
        market_id: order.marketId,
        side: order.side,
        nonce: order.nonce,
        valid_until: order.validUntil,
        signature: order.signature,
      },
    });
  }

  /** Current state of an order. Needs no session — the order id is the read credential. */
  getOrder(tokenId: number, orderId: string): Promise<Order> {
    return this.http.request<Order>(`/instances/${tokenId}/orders/${orderId}`);
  }

  /**
   * Polls an order until it leaves `pending`, or until `timeoutMs` passes (in
   * which case the still-pending order is returned).
   */
  async waitForOrder(
    tokenId: number,
    orderId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<Order> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const interval = options.intervalMs ?? 5_000;
    for (;;) {
      const order = await this.getOrder(tokenId, orderId);
      if (order.status !== "pending" || Date.now() >= deadline) return order;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /** Orders of the instance, most recent first (owner session). */
  async listOrders(tokenId: number): Promise<Order[]> {
    const { orders } = await this.authed<{ orders: Order[] }>(`/instances/${tokenId}/orders`);
    return orders;
  }

  private authed<T>(path: string, options: Parameters<Http["request"]>[1] = {}): Promise<T> {
    if (!this.token) {
      return Promise.reject(new Error("Not logged in: call login() or pass a session token first."));
    }
    return this.http.request<T>(path, { ...options, token: this.token });
  }
}
