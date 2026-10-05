// The owner of an instance: log in with the wallet, configure a market, read
// results, and build the on-chain transactions an instance needs.
import { createWalletClient, custom, parseEther } from "viem";

import {
  BotsClient,
  CHAIN_ID,
  ContractTransactions,
  DataClient,
  signerFromWalletClient,
} from "../src/index.js";

declare const window: { ethereum: Parameters<typeof custom>[0] };

export async function ownerFlow(tokenId: number) {
  const wallet = createWalletClient({ transport: custom(window.ethereum) });
  const [address] = await wallet.requestAddresses();
  const signer = signerFromWalletClient(wallet, address);

  const data = new DataClient({ baseUrl: "https://data.example.com" });
  const bots = new BotsClient({ baseUrl: "https://bots.example.com", chainId: CHAIN_ID.testnet });

  // 1. Log in: the wallet signs a one-time message.
  await bots.login(signer);

  // 2. Pick a market and let our AI trade it, with a 5% trailing stop.
  const [market] = await data.listMarkets();
  if (!market) throw new Error("no markets available");
  await bots.configureMarket(tokenId, market.id, {
    decision: "platform",
    settings: {
      interval: "1h",
      allocation: "1000",
      trailing_stop: { distance: { kind: "percent", value: "0.05" }, activation: null, stop_loss: null },
    },
  });

  // 3. Follow the results. Instances start in test mode: no real funds move.
  const statement = await bots.getStatement(tokenId);
  console.log(`net result so far: ${statement.net_result}`);

  // 4. Going live needs these transactions, signed by the owner's wallet.
  const txs = new ContractTransactions({ nft: "0x…", executor: "0x…" });
  const onboarding = [
    txs.setLimits(BigInt(tokenId), parseEther("1000")),
    txs.setMarketAllowed(BigInt(tokenId), market.pool_address as `0x${string}`, true),
    txs.approveToken(market.quote_token as `0x${string}`),
    txs.approveToken(market.base_token as `0x${string}`),
  ];
  for (const tx of onboarding) {
    await wallet.sendTransaction({ ...tx, account: address!, chain: null });
  }
}
