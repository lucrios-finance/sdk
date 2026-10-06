import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, maxUint256, zeroAddress } from "viem";

import { botInstanceNftAbi } from "./abis/botInstanceNft.js";
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

/**
 * Key of a pair traded through the aggregator. The executor uses it where a
 * directly traded market uses its pool address, so this is what an owner
 * passes to {@link ContractTransactions.setMarketAllowed} to allow the pair.
 * The order matters: `base` is the asset, `quote` what it is priced in.
 */
export function pairKey(base: Address, quote: Address): Address {
  const hash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }], [base, quote]));
  return `0x${hash.slice(-40)}`;
}

function partner(feeRecipient: Address | undefined): Address {
  return feeRecipient ?? zeroAddress;
}

/**
 * Builders for every on-chain action of an instance owner. Each one returns
 * an {@link UnsignedTransaction}; nothing here talks to the network.
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
   * Lets the executor move `token` out of the owner's wallet. An instance needs
   * this for the quote token (to enter) and for each asset it trades (to exit —
   * without it a stop cannot be executed). Defaults to an unlimited allowance.
   */
  approveToken(token: Address, amount: bigint = maxUint256): UnsignedTransaction {
    return {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [this.addresses.executor, amount] }),
      value: 0n,
    };
  }

  /**
   * Sets how much quote token may go into a single trade, and whether the
   * instance is paused. A new instance cannot trade until this is set. Pausing
   * blocks new entries only; open positions can always be closed.
   */
  setLimits(tokenId: bigint, maxPerTrade: bigint, paused = false): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({
        abi: tradeExecutorAbi,
        functionName: "setLimits",
        args: [tokenId, maxPerTrade, paused],
      }),
      value: 0n,
    };
  }

  /**
   * Allows or forbids the instance to trade in a market. `pool` is the pool
   * address for a directly traded market, or {@link pairKey} for a pair traded
   * through the aggregator.
   */
  setMarketAllowed(tokenId: bigint, pool: Address, allowed: boolean): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({
        abi: tradeExecutorAbi,
        functionName: "setMarketAllowed",
        args: [tokenId, pool, allowed],
      }),
      value: 0n,
    };
  }

  /**
   * Starts copying a leader instance. The follower pays the leader fee on its
   * own profit, at the rate in force when it started following. Only possible
   * with no open position.
   */
  follow(tokenId: bigint, leaderTokenId: bigint): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "follow", args: [tokenId, leaderTokenId] }),
      value: 0n,
    };
  }

  /** Stops copying. Only possible with no open position. */
  unfollow(tokenId: bigint): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "unfollow", args: [tokenId] }),
      value: 0n,
    };
  }

  /**
   * Drops the record of an open position without selling: the asset is already
   * in the owner's wallet and stops being managed by the bot. No fee is charged.
   */
  abandonPosition(tokenId: bigint, pool: Address): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "abandonPosition", args: [tokenId, pool] }),
      value: 0n,
    };
  }

  /**
   * Withdraws the fees accrued to the caller (partners and copy-trade leaders)
   * from the executor, in `token`.
   */
  withdrawFees(token: Address): UnsignedTransaction {
    return {
      to: this.addresses.executor,
      data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "withdraw", args: [token] }),
      value: 0n,
    };
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
}
