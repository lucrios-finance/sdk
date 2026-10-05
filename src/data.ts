import { Http, type HttpOptions } from "./http.js";
import type { CandleSeries, Interval, Market } from "./types.js";

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
}

function toUnixSeconds(value: Date | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}
