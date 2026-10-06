import { decodeFunctionData, erc20Abi, maxUint256, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { ContractTransactions, botInstanceNftAbi, pairKey, tradeExecutorAbi } from "../src/index.js";

const nft = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const partner = "0x3333333333333333333333333333333333333333";
const pool = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";

const txs = new ContractTransactions({ nft, executor });

describe("pairKey", () => {
  it("matches the key the executor contract derives", () => {
    // Reference value from the contract's own formula:
    // address(uint160(uint256(keccak256(abi.encode(base, quote))))).
    const base = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
    const quote = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

    expect(pairKey(base, quote)).toBe("0xa9b5590ec294da640537fd0fecd49e363e6210fe");
    expect(pairKey(quote, base)).not.toBe(pairKey(base, quote));
  });
});

describe("ContractTransactions", () => {
  it("mint sends the price to the NFT contract, with or without a partner", () => {
    const direct = txs.mint(80_000_000_000_000_000n);
    const viaPartner = txs.mint(80_000_000_000_000_000n, partner);

    expect(direct.to).toBe(nft);
    expect(direct.value).toBe(80_000_000_000_000_000n);
    expect(decodeFunctionData({ abi: botInstanceNftAbi, data: direct.data })).toEqual({
      functionName: "mint",
      args: [zeroAddress],
    });
    expect(decodeFunctionData({ abi: botInstanceNftAbi, data: viaPartner.data }).args).toEqual([partner]);
  });

  it("topUp carries the instance, the amount and the partner", () => {
    const tx = txs.topUp(7n, 10n ** 16n, partner);

    expect(tx.to).toBe(nft);
    expect(tx.value).toBe(10n ** 16n);
    expect(decodeFunctionData({ abi: botInstanceNftAbi, data: tx.data })).toEqual({
      functionName: "topUp",
      args: [7n, partner],
    });
  });

  it("approveToken targets the token and names the executor as spender", () => {
    const unlimited = txs.approveToken(token);
    const capped = txs.approveToken(token, 500n);

    expect(unlimited.to).toBe(token);
    expect(unlimited.value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: unlimited.data })).toEqual({
      functionName: "approve",
      args: [executor, maxUint256],
    });
    expect(decodeFunctionData({ abi: erc20Abi, data: capped.data }).args).toEqual([executor, 500n]);
  });

  it("owner settings go to the executor without value", () => {
    const cases = [
      { tx: txs.setLimits(7n, 1000n), functionName: "setLimits", args: [7n, 1000n, false] },
      { tx: txs.setLimits(7n, 0n, true), functionName: "setLimits", args: [7n, 0n, true] },
      { tx: txs.setMarketAllowed(7n, pool, true), functionName: "setMarketAllowed", args: [7n, pool, true] },
      { tx: txs.follow(7n, 1n), functionName: "follow", args: [7n, 1n] },
      { tx: txs.unfollow(7n), functionName: "unfollow", args: [7n] },
      { tx: txs.abandonPosition(7n, pool), functionName: "abandonPosition", args: [7n, pool] },
      { tx: txs.withdrawFees(token), functionName: "withdraw", args: [token] },
    ];

    for (const { tx, functionName, args } of cases) {
      expect(tx.to).toBe(executor);
      expect(tx.value).toBe(0n);
      expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data })).toEqual({ functionName, args });
    }
  });

  it("withdrawRevenue defaults to ETH on the NFT contract", () => {
    const tx = txs.withdrawRevenue();

    expect(tx.to).toBe(nft);
    expect(decodeFunctionData({ abi: botInstanceNftAbi, data: tx.data })).toEqual({
      functionName: "withdraw",
      args: [zeroAddress],
    });
  });
});
