/**
 * Shapes returned by the APIs, exactly as they travel on the wire
 * (snake_case). Amounts and prices are decimal strings — never parse them
 * with `Number()` if precision matters.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// ── market data ─────────────────────────────────────────────────────────────

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
/**
 * Where a pool stands in its lifecycle. Only `tracked` markets have candles
 * being recorded and are returned by the market list.
 */
export type MarketStatus = "discovered" | "tracked" | "dormant" | "removed" | "blocked";

export interface Market {
  id: string;
  /** e.g. `WETH/USDG`. Every price of the market is "quote per 1 base". */
  symbol: string;
  /** Name of the DEX the pool belongs to, e.g. `uniswap-v3-robinhood`. */
  dex: string;
  /** Pool address, or the 32-byte pool id for Uniswap v4 pools. */
  pool_address: string;
  pool_id: string | null;
  base_token: string;
  quote_token: string;
  base_decimals: number;
  quote_decimals: number;
  base_is_token0: boolean | null;
  usd_via_market_id: string | null;
  start_block: number | null;
  /** True exactly when `status` is `tracked`. */
  enabled: boolean;
  created_at: string;
  status: MarketStatus;
  /** Kept tracked regardless of activity. */
  pinned: boolean;
  block_reason: string | null;
  /** Liquidity and 24h volume in USD, as last seen. Decimal strings. */
  liquidity_usd: string | null;
  volume_24h_usd: string | null;
  first_seen_at: string;
  last_seen_at: string | null;
  last_active_at: string | null;
  status_changed_at: string;
}

export interface Candle {
  /** Start of the interval, RFC 3339. */
  open_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  /** Volume in the quote token. */
  volume: string;
}

export interface CandleSeries {
  market_id: string;
  symbol: string;
  interval: Interval;
  /** Chronological order. */
  candles: Candle[];
}

// ── instances ───────────────────────────────────────────────────────────────

/** `paper` = test mode: prices are marked, no transaction is sent. */
export type ExecutionMode = "live" | "paper";
/** Who decides the trades of a market: our AI (`platform`) or your own system (`external`). */
export type DecisionMode = "platform" | "external";

export interface Instance {
  /** The NFT id. */
  token_id: number;
  owner: Address;
  execution: ExecutionMode;
  created_at: string;
  updated_at: string;
}

export type TrailDistance =
  /** Fraction of the peak: `"0.05"` trails 5% below it. */
  | { kind: "percent"; value: string }
  /** Multiple of the current ATR. */
  | { kind: "atr_multiple"; value: string };

export interface TrailingStopConfig {
  distance: TrailDistance;
  /** Minimum profit (fraction of the entry) before the stop starts trailing. */
  activation: string | null;
  /** Fixed stop below the entry, as a fraction. */
  stop_loss: string | null;
}

export interface MarketSettings {
  interval: Interval;
  /** Quote-token amount used on each entry. `"0"` = watched but not traded. */
  allocation: string;
  thresholds: { enter: string; exit: string };
  trailing_stop: TrailingStopConfig | null;
}

export interface InstanceMarket {
  token_id: number;
  market_id: string;
  decision: DecisionMode;
  enabled: boolean;
  settings: MarketSettings;
  last_candle: string | null;
}

export type PositionStatus = "open" | "closed";
export type ExitReason = "signal" | "stop" | "order";

export interface Position {
  id: string;
  token_id: number;
  market_id: string;
  /** True in test mode: the price was only marked. */
  simulated: boolean;
  status: PositionStatus;
  entry_time: string;
  entry_price: string;
  quantity: string;
  cost: string;
  exec_costs: string;
  exit_time: string | null;
  exit_price: string | null;
  proceeds: string | null;
  exit_reason: ExitReason | null;
}

export interface Credits {
  token_id: number;
  /** Credit balance in ETH. Zero or negative = the instance opens no new position. */
  balance_eth: string;
}

/** Test-mode statement: simulated profit against what running the instance cost. */
export interface PaperStatement {
  closed_positions: number;
  gross_profit: string;
  execution_costs: string;
  ai_credits: string;
  /** API usage fees actually debited (one per executed order), in USD. */
  api_fees: string;
  net_result: string;
}

// ── agent and orders ────────────────────────────────────────────────────────

export interface Agent {
  token_id: number;
  address: Address;
  expires_at: string;
}

export type OrderSide = "enter" | "exit";
export type OrderStatus = "pending" | "filled" | "rejected" | "expired";

export interface Order {
  id: string;
  token_id: number;
  market_id: string;
  side: OrderSide;
  nonce: number;
  valid_until: string;
  signer: Address;
  status: OrderStatus;
  /** Why it was rejected or expired. */
  reason: string | null;
  fill_price: string | null;
  created_at: string;
  resolved_at: string | null;
}

// ── auth ────────────────────────────────────────────────────────────────────

export interface LoginChallenge {
  address: Address;
  nonce: string;
  /** Exact text the wallet must sign. */
  message: string;
  expires_at: string;
}

export interface Session {
  address: Address;
  token: string;
  expires_at: string;
}
