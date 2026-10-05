// Your own trading system (or AI agent) driving an instance with a delegated
// key. The agent key can only sign orders: it cannot move funds, change limits
// or read the owner's session.
import { privateKeyToAccount } from "viem/accounts";

import { ApiError, BotsClient, CHAIN_ID, nextNonce, signerFromAccount, validFor } from "../src/index.js";

export async function agentFlow(tokenId: number, marketId: string, agentPrivateKey: `0x${string}`) {
  const agent = signerFromAccount(privateKeyToAccount(agentPrivateKey));
  const bots = new BotsClient({ baseUrl: "https://bots.example.com", chainId: CHAIN_ID.testnet });

  // The owner must have (once, from their own session):
  //   await bots.configureMarket(tokenId, marketId, { decision: "external", settings: { allocation: "1000" } });
  //   await bots.setAgent(tokenId, agent.address, new Date(Date.now() + 30 * 86_400_000));

  try {
    const order = await bots.placeOrder(agent, {
      tokenId,
      marketId,
      side: "enter",
      nonce: nextNonce(),
      validUntil: validFor(300),
    });

    // Accepted as `pending`; the engine executes it on its next cycle.
    const done = await bots.waitForOrder(tokenId, order.id);
    if (done.status === "filled") console.log(`filled at ${done.fill_price}`);
    else console.log(`${done.status}: ${done.reason ?? "still pending"}`);
  } catch (error) {
    if (error instanceof ApiError && error.retryable) {
      // 429 or 5xx: the same order can be sent again unchanged.
    } else {
      throw error;
    }
  }
}
