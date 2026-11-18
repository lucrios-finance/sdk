import { keccak256, stringToHex } from "viem";

import type { Hex } from "./types.js";

/**
 * The record of one decision of an agent trading from a vault. The AI does
 * not run on-chain; what can be audited is that each trade matches a
 * published decision. The executor writes the {@link decisionHash} of this
 * record into the `decision` field of its `PositionOpened` and
 * `PositionClosed` events.
 *
 * Version 1. A new version changes the fields; old records keep hashing by
 * their own.
 */
export interface DecisionRecord {
  version: number;
  position_id: string;
  token_id: number;
  market_id: string;
  /** The token bought or sold, lowercase. */
  base_token: string;
  side: "open" | "close";
  /** The skill that decided; `null` = the owner's market strategy. */
  skill: string | null;
  /** Candle price at which the entry was decided, as a decimal string. */
  entry_price: string;
  /** Decided entry size, in wei of WETH. */
  entry_wei: string;
  /** Why the position was closed. Only on `close`. */
  exit_reason: string | null;
  /** RFC 3339. The entry time, or when the exit started. */
  decided_at: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * JSON in a single form: object keys in code-point order, no whitespace. The
 * hash of a record then does not depend on the order its fields were written
 * or stored in.
 */
export function canonicalJson(value: unknown): string {
  const v = value as Json;
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).sort(byCodePoint);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(v[key])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `keccak256` of the canonical JSON of a published decision record. Compare
 * it with the `decision` of the executor event of that trade.
 */
export function decisionHash(record: DecisionRecord | Record<string, unknown>): Hex {
  return keccak256(stringToHex(canonicalJson(record)));
}
