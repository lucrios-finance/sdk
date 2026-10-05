export { ApiError, NetworkError } from "./errors.js";
export type { FetchLike, HttpOptions } from "./http.js";

export { DataClient } from "./data.js";
export type { CandleQuery } from "./data.js";

export { BotsClient } from "./bots.js";
export type { BotsClientOptions, MarketConfig } from "./bots.js";

export {
  CHAIN_ID,
  EIP712_NAME,
  EIP712_VERSION,
  nextNonce,
  orderTypedData,
  signOrder,
  validFor,
} from "./orders.js";
export type { OrderIntent, SignedOrder } from "./orders.js";

export { signerFromAccount, signerFromWalletClient } from "./signer.js";
export type { OrderTypedData, Signer, ViemAccountLike, ViemWalletClientLike } from "./signer.js";

export { ContractTransactions } from "./contracts.js";
export type { ContractAddresses, UnsignedTransaction } from "./contracts.js";

export { botInstanceNftAbi } from "./abis/botInstanceNft.js";
export { tradeExecutorAbi } from "./abis/tradeExecutor.js";

export type * from "./types.js";
