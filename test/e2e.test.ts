// End-to-end against a running bots-api. Skipped unless BOTS_API_URL is set.
//
// Expects an instance (E2E_TOKEN_ID, default 1) owned by the well-known local
// development key below — create it with:
//   admin create-instance 1 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0.004
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { ApiError, BotsClient, CHAIN_ID, nextNonce, signerFromAccount, validFor } from "../src/index.js";

const baseUrl = process.env["BOTS_API_URL"];
const tokenId = Number(process.env["E2E_TOKEN_ID"] ?? 1);

// First account of the standard local development mnemonic. Public by design;
// never holds real funds.
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

describe.skipIf(!baseUrl)("bots-api end to end", () => {
  const client = () => new BotsClient({ baseUrl: baseUrl!, chainId: CHAIN_ID.testnet });
  const marketId = crypto.randomUUID();

  it("logs in with a wallet and manages the instance", async () => {
    const api = client();
    const session = await api.login(signerFromAccount(owner));
    expect(session.address).toBe(owner.address.toLowerCase());

    const instances = await api.listInstances();
    expect(instances.map((i) => i.token_id)).toContain(tokenId);
    expect((await api.getInstance(tokenId)).execution).toBe("paper");

    const market = await api.configureMarket(tokenId, marketId, {
      decision: "external",
      settings: { allocation: "1000", interval: "15m" },
    });
    expect(market.decision).toBe("external");
    expect(market.settings.allocation).toBe("1000");
    expect(market.settings.thresholds.enter).toBeDefined();

    expect((await api.getCredits(tokenId)).balance_eth).toMatch(/^\d+\.\d+$/);
    expect((await api.getStatement(tokenId)).closed_positions).toBeTypeOf("number");
    expect(await api.listPositions(tokenId, { status: "open" })).toEqual([]);
  });

  it("rejects a login signed by another wallet", async () => {
    const api = client();
    const impostor = privateKeyToAccount(generatePrivateKey());

    const error = await api
      .login({ ...signerFromAccount(impostor), address: owner.address })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED", retryable: false });
  });

  it("delegates an agent key whose signed orders the API accepts", async () => {
    const ownerApi = client();
    await ownerApi.login(signerFromAccount(owner));

    const agentAccount = privateKeyToAccount(generatePrivateKey());
    const agent = signerFromAccount(agentAccount);
    const agentApi = client(); // never logs in

    const intent = () => ({
      tokenId,
      marketId,
      side: "enter" as const,
      nonce: nextNonce(),
      validUntil: validFor(300),
    });

    // Before delegation the agent's signature is worthless.
    await expect(agentApi.placeOrder(agent, intent())).rejects.toMatchObject({ status: 403 });

    const delegated = await ownerApi.setAgent(tokenId, agentAccount.address, new Date(Date.now() + 86_400_000));
    expect(delegated.address).toBe(agentAccount.address.toLowerCase());

    // The EIP-712 signature produced by the SDK is verified by the Rust API.
    const order = await agentApi.placeOrder(agent, intent());
    expect(order.status).toBe("pending");
    expect(order.signer).toBe(agentAccount.address.toLowerCase());

    // The agent follows its order without a session; the owner sees it listed.
    expect((await agentApi.getOrder(tokenId, order.id)).id).toBe(order.id);
    expect((await ownerApi.listOrders(tokenId)).map((o) => o.id)).toContain(order.id);

    // A nonce that does not increase is refused.
    await expect(agentApi.placeOrder(agent, { ...intent(), nonce: 1 })).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    await ownerApi.revokeAgent(tokenId);
    await expect(agentApi.placeOrder(agent, intent())).rejects.toMatchObject({ status: 403 });
  });
});
