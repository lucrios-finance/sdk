import { readFileSync } from "node:fs";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { CHAIN_ID, nextNonce, orderTypedData, signOrder, signerFromAccount, validFor } from "../src/index.js";
import type { OrderIntent } from "../src/index.js";

const intent: OrderIntent = {
  tokenId: 7,
  marketId: "52e65b17-fb6e-5ba0-0ed8-06f37afcd2da",
  side: "enter",
  nonce: 1,
  validUntil: 1_791_200_000,
};

describe("order typed data", () => {
  it("hashes to the value pinned by the API", () => {
    // The API pins this hash for exactly this order in its own test suite (and
    // it was checked against ethers). The fixture is a copy of that value; the
    // API's CI fails if the two ever differ, because every order signed by the
    // SDK would then be rejected.
    const golden = readFileSync(new URL("./fixtures/order_hash.golden", import.meta.url), "utf8").trim();

    expect(hashTypedData(orderTypedData(CHAIN_ID.testnet, intent))).toBe(golden);
  });

  it("normalizes the market id to the lowercase form the API hashes", () => {
    const upper = { ...intent, marketId: intent.marketId.toUpperCase() };
    expect(hashTypedData(orderTypedData(CHAIN_ID.testnet, upper))).toBe(
      hashTypedData(orderTypedData(CHAIN_ID.testnet, intent)),
    );
  });

  it("binds the chain and every field", () => {
    const base = hashTypedData(orderTypedData(CHAIN_ID.testnet, intent));
    const variants: OrderIntent[] = [
      { ...intent, tokenId: 8 },
      { ...intent, marketId: "00000000-0000-0000-0000-000000000001" },
      { ...intent, side: "exit" },
      { ...intent, nonce: 2 },
      { ...intent, validUntil: intent.validUntil + 1 },
    ];
    for (const variant of variants) {
      expect(hashTypedData(orderTypedData(CHAIN_ID.testnet, variant))).not.toBe(base);
    }
    expect(hashTypedData(orderTypedData(CHAIN_ID.mainnet, intent))).not.toBe(base);
  });

  it("rejects values that cannot be represented exactly", () => {
    expect(() => orderTypedData(CHAIN_ID.testnet, { ...intent, nonce: -1 })).toThrow(RangeError);
    expect(() => orderTypedData(CHAIN_ID.testnet, { ...intent, tokenId: 1.5 })).toThrow(RangeError);
    expect(() => orderTypedData(CHAIN_ID.testnet, { ...intent, validUntil: 2 ** 60 })).toThrow(RangeError);
  });
});

describe("signOrder", () => {
  it("produces a signature that recovers to the signer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());

    const signed = await signOrder(signerFromAccount(account), CHAIN_ID.testnet, intent);

    expect(signed).toMatchObject(intent);
    const recovered = await recoverTypedDataAddress({
      ...orderTypedData(CHAIN_ID.testnet, intent),
      signature: signed.signature,
    });
    expect(recovered).toBe(account.address);
  });
});

describe("helpers", () => {
  it("nextNonce grows with the clock and validFor is in seconds", () => {
    expect(nextNonce(2_000)).toBeGreaterThan(nextNonce(1_000));
    expect(validFor(300, 10_000)).toBe(310);
  });
});
