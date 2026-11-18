import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getContractAddress,
  keccak256,
  maxUint256,
  numberToHex,
  zeroAddress,
} from "viem";

import { botInstanceNftAbi } from "./abis/botInstanceNft.js";
import { instanceVaultAbi } from "./abis/instanceVault.js";
import { tradeExecutorAbi } from "./abis/tradeExecutor.js";
import type { Address, Hex } from "./types.js";

/** Where the contracts live on the chain you are using. */
export interface ContractAddresses {
  nft: Address;
  executor: Address;
}

/**
 * A transaction ready to be signed by the instance owner's wallet, e.g. with
 * viem's `walletClient.sendTransaction(tx)`. The SDK never signs or sends
 * transactions itself.
 */
export interface UnsignedTransaction {
  to: Address;
  data: Hex;
  /** Wei to send along. */
  value: bigint;
}

/** What an owner allows the instance to do with the funds in its vault. */
export interface InstanceLimits {
  /** Most quote token (WETH, in wei) a single entry may use. 0 = no trading. */
  maxPerTrade: bigint;
  /** Blocks new entries. Open positions can always be closed. */
  paused?: boolean;
  /**
   * Allows every market at once: the listed pools and any pair whose quote
   * token the protocol accepts. Skills that hunt new pools need it, since the
   * pool does not exist yet when the owner sets the instance up.
   */
  anyMarket?: boolean;
}

/**
 * Key of a pair traded through the aggregator. The executor uses it where a
 * directly traded market uses its pool address, so this is what an owner
 * passes to {@link ContractTransactions.setMarketAllowed} to allow the pair,
 * and what the `market` of a `PositionOpened` / `PositionClosed` event is.
 * The order matters: `base` is the asset, `quote` what it is priced in.
 */
export function pairKey(base: Address, quote: Address): Address {
  const hash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }], [base, quote]));
  return `0x${hash.slice(-40)}`;
}

/**
 * Address of an instance's vault, whether it was created yet or not — funds
 * can be sent to it before it exists. Same result as the executor's
 * `vaultOf(tokenId)`, without a network call; `vaultImplementation` is the
 * executor's public `vaultImplementation()`, fixed for the executor's life.
 */
export function vaultAddress(executor: Address, vaultImplementation: Address, tokenId: bigint): Address {
  // OpenZeppelin Clones (EIP-1167 minimal proxy), created with CREATE2 by the
  // executor, salt = the token id.
  const initCode = concatHex([
    "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
    vaultImplementation,
    "0x5af43d82803e903d91602b57fd5bf3",
  ]);
  return getContractAddress({
    opcode: "CREATE2",
    from: executor,
    salt: numberToHex(tokenId, { size: 32 }),
    bytecode: initCode,
  });
}

function partner(feeRecipient: Address | undefined): Address {
  return feeRecipient ?? zeroAddress;
}

/**
 * Builders for every on-chain action of an instance owner. Each one returns
 * an {@link UnsignedTransaction}; nothing here talks to the network.
 *
 * An instance trades with the funds in its **vault**: one contract per NFT,
 * whose current owner can withdraw everything at any time. The executor moves
 * the funds only to trade, within the owner's limits, and the result always
 * goes back to the vault. Transferring the NFT transfers the vault.
 */
export class ContractTransactions {
  constructor(private readonly addresses: ContractAddresses) {}

  /**
   * Mints a bot instance paying in ETH. `price` must be at least the current
   * mint price (read `paymentTokens(address(0))` on the NFT contract); any
   * excess is refunded by the contract. `feeRecipient` attributes the mint to
   * a partner.
   */
  mint(price: bigint, feeRecipient?: Address): UnsignedTransaction {
    return {
      to: this.addresses.nft,
      data: encodeFunctionData({ abi: botInstanceNftAbi, functionName: "mint", args: [partner(feeRecipient)] }),
      value: price,
    };
  }

  /** Tops up the credits of an instance with ETH. Anyone can top up any instance. */
  topUp(tokenId: bigint, amount: bigint, feeRecipient?: Address): UnsignedTransaction {
    return {
      to: this.addresses.nft,
      data: encodeFunctionData({
        abi: botInstanceNftAbi,
        functionName: "topUp",
        args: [tokenId, partner(feeRecipient)],
      }),
      value: amount,
    };
  }

  /**
   * Creates the vault of an instance. Optional: the executor creates it on the
   * first trade, and funds can be sent to {@link vaultAddress} before that.
   * Anyone can call it.
   */
  createVault(tokenId: bigint): UnsignedTransaction {
    return this.executorCall(encodeFunctionData({ abi: tradeExecutorAbi, functionName: "createVault", args: [tokenId] }));
  }

  /**
   * Sets how much may go into a single trade, whether the instance is paused
   * and whether every market is allowed. A new instance cannot trade until
   * this is set. Each call replaces all three values.
   */
  setLimits(tokenId: bigint, limits: InstanceLimits): UnsignedTransaction {
    return this.executorCall(
      encodeFunctionData({
        abi: tradeExecutorAbi,
        functionName: "setLimits",
        args: [tokenId, limits.maxPerTrade, limits.paused ?? false, limits.anyMarket ?? false],
      }),
    );
  }

  /**
   * Allows or forbids the instance to trade in one market. `market` is the
   * pool address for a directly traded market, or {@link pairKey} for a pair
   * traded through the aggregator. Not needed with `anyMarket`.
   */
  setMarketAllowed(tokenId: bigint, market: Address, allowed: boolean): UnsignedTransaction {
    return this.executorCall(
      encodeFunctionData({
        abi: tradeExecutorAbi,
        functionName: "setMarketAllowed",
        args: [tokenId, market, allowed],
      }),
    );
  }

  /**
   * Drops the record of an open position without selling: the asset stays in
   * the vault and stops being managed by the bot. No fee is charged.
   */
  dropPosition(tokenId: bigint, market: Address): UnsignedTransaction {
    return this.executorCall(
      encodeFunctionData({ abi: tradeExecutorAbi, functionName: "dropPosition", args: [tokenId, market] }),
    );
  }

  /**
   * Drops the record of an open liquidity range without closing it. Withdraw
   * the position NFT from the vault ({@link VaultTransactions.withdrawNft}) to
   * manage it yourself.
   */
  dropRange(tokenId: bigint, positionNftId: bigint): UnsignedTransaction {
    return this.executorCall(
      encodeFunctionData({ abi: tradeExecutorAbi, functionName: "dropRange", args: [tokenId, positionNftId] }),
    );
  }

  /** Withdraws the fees accrued to the caller (partners) from the executor, in `token`. */
  withdrawFees(token: Address): UnsignedTransaction {
    return this.executorCall(encodeFunctionData({ abi: tradeExecutorAbi, functionName: "withdraw", args: [token] }));
  }

  /**
   * Withdraws the mint and top-up revenue accrued to the caller (partners) from
   * the NFT contract. `token` defaults to ETH.
   */
  withdrawRevenue(token: Address = zeroAddress): UnsignedTransaction {
    return {
      to: this.addresses.nft,
      data: encodeFunctionData({ abi: botInstanceNftAbi, functionName: "withdraw", args: [token] }),
      value: 0n,
    };
  }

  /**
   * Deposits and withdrawals of one vault. `vault` is {@link vaultAddress}
   * (or the executor's `vaultOf(tokenId)`).
   */
  vault(vault: Address): VaultTransactions {
    return new VaultTransactions(vault);
  }

  private executorCall(data: Hex): UnsignedTransaction {
    return { to: this.addresses.executor, data, value: 0n };
  }
}

/**
 * Moving funds in and out of an instance's vault. Deposits can come from any
 * wallet; withdrawals only from the current owner of the instance's NFT, and
 * nothing in the executor can block them.
 */
export class VaultTransactions {
  constructor(readonly address: Address) {}

  /**
   * Sends ETH to the vault. The bot wraps it into WETH before trading with it,
   * so this is the simplest way to fund an instance.
   */
  depositNative(amount: bigint): UnsignedTransaction {
    return { to: this.address, data: "0x", value: amount };
  }

  /** Sends an ERC-20 (e.g. WETH) to the vault. */
  depositToken(token: Address, amount: bigint): UnsignedTransaction {
    return {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [this.address, amount] }),
      value: 0n,
    };
  }

  /**
   * Withdraws an ERC-20 to the owner's wallet; everything when `amount` is
   * left out. Withdrawing the asset of an open position takes it out of the
   * bot's hands: it is never sold, and no fee is charged.
   */
  withdraw(token: Address, amount: bigint = maxUint256): UnsignedTransaction {
    return this.call(encodeFunctionData({ abi: instanceVaultAbi, functionName: "withdraw", args: [token, amount] }));
  }

  /** Withdraws ETH that was not wrapped yet; everything when `amount` is left out. */
  withdrawNative(amount: bigint = maxUint256): UnsignedTransaction {
    return this.call(encodeFunctionData({ abi: instanceVaultAbi, functionName: "withdrawNative", args: [amount] }));
  }

  /** Withdraws an NFT, e.g. the position NFT of a liquidity range. */
  withdrawNft(collection: Address, id: bigint): UnsignedTransaction {
    return this.call(encodeFunctionData({ abi: instanceVaultAbi, functionName: "withdrawNft", args: [collection, id] }));
  }

  private call(data: Hex): UnsignedTransaction {
    return { to: this.address, data, value: 0n };
  }
}
