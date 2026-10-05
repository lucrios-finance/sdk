import type { Address, Hex } from "./types.js";

/** The EIP-712 payload of an order, in the shape wallets and viem expect. */
export interface OrderTypedData {
  domain: { name: string; version: string; chainId: number };
  types: {
    Order712: readonly [
      { name: "instanceId"; type: "uint256" },
      { name: "market"; type: "string" },
      { name: "side"; type: "uint8" },
      { name: "nonce"; type: "uint256" },
      { name: "validUntil"; type: "uint64" },
    ];
  };
  primaryType: "Order712";
  message: {
    instanceId: bigint;
    market: string;
    side: number;
    nonce: bigint;
    validUntil: bigint;
  };
}

/**
 * What the SDK needs from a wallet: its address and the two signing
 * operations. Use {@link signerFromAccount} or {@link signerFromWalletClient}
 * to build one from viem, or implement it for any other wallet.
 */
export interface Signer {
  address: Address;
  /** `personal_sign` (EIP-191) of a UTF-8 string. Used to log in. */
  signMessage(message: string): Promise<Hex>;
  /** EIP-712 signature. Used to sign orders. */
  signTypedData(typedData: OrderTypedData): Promise<Hex>;
}

/** Structural subset of a viem `LocalAccount` (e.g. `privateKeyToAccount`). */
export interface ViemAccountLike {
  address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(args: any): Promise<Hex>;
}

/** Structural subset of a viem `WalletClient` (browser wallets, wagmi). */
export interface ViemWalletClientLike {
  account?: { address: Address } | undefined;
  signMessage(args: { account: Address; message: string }): Promise<Hex>;
  signTypedData(args: any): Promise<Hex>;
}

/** Signer backed by a local key — the usual choice for an agent key on a server. */
export function signerFromAccount(account: ViemAccountLike): Signer {
  return {
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    signTypedData: (typedData) => account.signTypedData(typedData),
  };
}

/** Signer backed by a connected wallet — the usual choice in a browser. */
export function signerFromWalletClient(client: ViemWalletClientLike, address?: Address): Signer {
  const account = address ?? client.account?.address;
  if (!account) {
    throw new Error("The wallet client has no account; pass the address explicitly.");
  }
  return {
    address: account,
    signMessage: (message) => client.signMessage({ account, message }),
    signTypedData: (typedData) => client.signTypedData({ account, ...typedData }),
  };
}
