import type { OrderTypedData, Signer } from "./signer.js";
import type { Hex, OrderSide } from "./types.js";

/** EIP-712 domain of the bots API. Changing either value invalidates every signature. */
export const EIP712_NAME = "Lucrios";
export const EIP712_VERSION = "1";

/** Robinhood Chain ids. An order signed for one chain is not valid on the other. */
export const CHAIN_ID = { mainnet: 4663, testnet: 46630 } as const;

/** What an order says: make this instance enter or exit this market. */
export interface OrderIntent {
  tokenId: number;
  /** Market UUID, as returned by the data API. */
  marketId: string;
  side: OrderSide;
  /**
   * Must be greater than the nonce of every previous order of the instance.
   * {@link nextNonce} gives a value that keeps increasing.
   */
  nonce: number;
  /** Unix timestamp in seconds after which the order must not be executed. */
  validUntil: number;
}

export interface SignedOrder extends OrderIntent {
  signature: Hex;
}

/**
 * A nonce that grows with the clock (milliseconds). Enough for one sender per
 * instance; if several processes send orders for the same instance, coordinate
 * the nonce yourself.
 */
export function nextNonce(now: number = Date.now()): number {
  return now;
}

/** Unix timestamp `seconds` from now. */
export function validFor(seconds: number, now: number = Date.now()): number {
  return Math.floor(now / 1000) + seconds;
}

/**
 * The typed data a wallet signs for an order. Exposed so you can sign with any
 * wallet library; the result must be byte-for-byte what the API hashes.
 */
export function orderTypedData(chainId: number, intent: OrderIntent): OrderTypedData {
  for (const [name, value] of [
    ["tokenId", intent.tokenId],
    ["nonce", intent.nonce],
    ["validUntil", intent.validUntil],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
    }
  }

  return {
    domain: { name: EIP712_NAME, version: EIP712_VERSION, chainId },
    types: {
      Order712: [
        { name: "instanceId", type: "uint256" },
        { name: "market", type: "string" },
        { name: "side", type: "uint8" },
        { name: "nonce", type: "uint256" },
        { name: "validUntil", type: "uint64" },
      ],
    },
    primaryType: "Order712",
    message: {
      instanceId: BigInt(intent.tokenId),
      // The API hashes the UUID in its canonical lowercase form.
      market: intent.marketId.toLowerCase(),
      side: intent.side === "enter" ? 0 : 1,
      nonce: BigInt(intent.nonce),
      validUntil: BigInt(intent.validUntil),
    },
  };
}

/** Signs an order with the instance owner's wallet or with its delegated agent key. */
export async function signOrder(signer: Signer, chainId: number, intent: OrderIntent): Promise<SignedOrder> {
  const signature = await signer.signTypedData(orderTypedData(chainId, intent));
  return { ...intent, signature };
}
