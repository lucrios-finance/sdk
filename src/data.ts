import { Http, type HttpOptions } from "./http.js";
import type { CandleSeries, Interval, LastPrice, Market, PoolPage, PoolSort } from "./types.js";

export interface CandleQuery {
  /** Defaults to `1m`. */
  interval?: Interval;
  /** Inclusive lower bound. A `Date` or a unix timestamp in seconds. */
  from?: Date | number;
  /** Exclusive upper bound — also the pagination cursor. */
  to?: Date | number;
  /** 1 to 1000. Defaults to 500. */
  limit?: number;
  /** Fill intervals without trades with the previous close and zero volume. */
  fill?: boolean;
}

export interface PoolQuery {
  /** Defaults to `volume`. */
  sort?: PoolSort;
  /** Defaults to `desc`. Pools without the sorted value come last either way. */
  order?: "asc" | "desc";
  /** Starts at 1. */
  page?: number;
  /** 1 to 100. Defaults to 25. */
  perPage?: number;
  /** Part of the symbol, or exactly a token address, the pool address or the market id. */
  search?: string;
  minVolumeUsd?: number | string;
  minLiquidityUsd?: number | string;
  minHolders?: number;
  /** Minimum holders gained in 24 hours. May be negative. */
  minHoldersChange?: number;
}

/** Client for the public market-data API: markets and OHLC candles. */
export class DataClient {
  private readonly http: Http;

  constructor(options: HttpOptions) {
    this.http = new Http(options);
  }

  /** Enabled markets. Use the `id` of a market everywhere else. */
  async listMarkets(): Promise<Market[]> {
    const { markets } = await this.http.request<{ markets: Market[] }>("/markets");
    return markets;
  }

  /**
   * Every pool the indexer has seen trading, one page at a time, with the
   * numbers of its last 24 hours. Wider than `listMarkets`, which only has
   * the markets the bots trade.
   */
  listPools(query: PoolQuery = {}): Promise<PoolPage> {
    return this.http.request<PoolPage>("/pools", {
      query: {
        sort: query.sort,
        order: query.order,
        page: query.page,
        per_page: query.perPage,
        q: query.search?.trim() || undefined,
        min_volume_usd: query.minVolumeUsd,
        min_liquidity_usd: query.minLiquidityUsd,
        min_holders: query.minHolders,
        min_holders_change: query.minHoldersChange,
      },
    });
  }

  /**
   * The most recent candles inside `[from, to)`, in chronological order.
   * To page backwards, call again with `to` set to the `open_time` of the
   * first candle you received.
   */
  getCandles(marketId: string, query: CandleQuery = {}): Promise<CandleSeries> {
    return this.http.request<CandleSeries>(`/markets/${marketId}/candles`, {
      query: {
        interval: query.interval,
        from: toUnixSeconds(query.from),
        to: toUnixSeconds(query.to),
        limit: query.limit,
        fill: query.fill,
      },
    });
  }

  /**
   * Price of the latest swap of the market, with the block it happened in.
   * Updated block by block; candles only close once a minute. Fails with
   * `NOT_FOUND` while the market has no indexed swap yet.
   */
  getLastPrice(marketId: string): Promise<LastPrice> {
    return this.http.request<LastPrice>(`/markets/${marketId}/price`);
  }
}

function toUnixSeconds(value: Date | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}
