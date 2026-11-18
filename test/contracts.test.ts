import { decodeFunctionData, erc20Abi, maxUint256, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import {
  ContractTransactions,
  botInstanceNftAbi,
  instanceVaultAbi,
  pairKey,
  tradeExecutorAbi,
  vaultAddress,
} from "../src/index.js";

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

describe("vaultAddress", () => {
  it("matches the executor's vaultOf", () => {
    // Read from a chain: script/Local.s.sol of lucrios-finance/contracts on
    // anvil, then `vaultImplementation()` and `vaultOf(7)` / `vaultOf(900001)`
    // on the executor.
    const deployed = "0x0165878A594ca255338adfa4d48449f69242Eb8F";
    const implementation = "0x3B02fF1e626Ed7a8fd6eC5299e2C54e1421B626B";

    expect(vaultAddress(deployed, implementation, 7n)).toBe("0x362B54F05AeC6B5b965cE4Fae1bF9F4A204E62BF");
    expect(vaultAddress(deployed, implementation, 900001n)).toBe("0x222F132e9856f67806Cc1af2dfAA28dF87B3855a");
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

  it("owner settings go to the executor without value", () => {
    const cases = [
      { tx: txs.createVault(7n), functionName: "createVault", args: [7n] },
      { tx: txs.setLimits(7n, { maxPerTrade: 1000n }), functionName: "setLimits", args: [7n, 1000n, false, false] },
      {
        tx: txs.setLimits(7n, { maxPerTrade: 0n, paused: true, anyMarket: true }),
        functionName: "setLimits",
        args: [7n, 0n, true, true],
      },
      { tx: txs.setMarketAllowed(7n, pool, true), functionName: "setMarketAllowed", args: [7n, pool, true] },
      { tx: txs.dropPosition(7n, pool), functionName: "dropPosition", args: [7n, pool] },
      { tx: txs.dropRange(7n, 42n), functionName: "dropRange", args: [7n, 42n] },
      { tx: txs.withdrawFees(token), functionName: "withdraw", args: [token] },
    ];

    for (const { tx, functionName, args } of cases) {
      expect(tx.to).toBe(executor);
      expect(tx.value).toBe(0n);
      expect(decodeFunctionData({ abi: tradeExecutorAbi, data: tx.data })).toEqual({ functionName, args });
    }
  });

  it("deposits send ETH to the vault, or transfer the token to it", () => {
    const vault = txs.vault(pool);

    expect(vault.depositNative(10n ** 18n)).toEqual({ to: pool, data: "0x", value: 10n ** 18n });

    const weth = vault.depositToken(token, 500n);
    expect(weth.to).toBe(token);
    expect(weth.value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: weth.data })).toEqual({
      functionName: "transfer",
      args: [pool, 500n],
    });
  });

  it("withdrawals go to the vault, everything by default", () => {
    const vault = txs.vault(pool);
    const cases = [
      { tx: vault.withdraw(token), functionName: "withdraw", args: [token, maxUint256] },
      { tx: vault.withdraw(token, 5n), functionName: "withdraw", args: [token, 5n] },
      { tx: vault.withdrawNative(), functionName: "withdrawNative", args: [maxUint256] },
      { tx: vault.withdrawNft(partner, 42n), functionName: "withdrawNft", args: [partner, 42n] },
    ];

    for (const { tx, functionName, args } of cases) {
      expect(tx.to).toBe(pool);
      expect(tx.value).toBe(0n);
      expect(decodeFunctionData({ abi: instanceVaultAbi, data: tx.data })).toEqual({ functionName, args });
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
