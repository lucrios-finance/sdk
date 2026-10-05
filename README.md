# @lucrios/sdk

TypeScript SDK for the Lucrios trading bots: market data, bot instances, signed
orders and the on-chain transactions an instance needs.

```bash
npm install @lucrios/sdk viem
```

`viem` is a peer dependency. The SDK works in browsers and in Node 18+.

> **Status:** pre-release. The package is not on npm yet and the contracts are
> not deployed; the API surface may still change.

## What is in the box

| Export | Use it to |
|---|---|
| `DataClient` | list markets and read OHLC candles |
| `BotsClient` | log in with a wallet, configure an instance, read positions, credits and the test-mode statement, delegate an agent key, send orders |
| `signOrder`, `orderTypedData` | sign an order (EIP-712) with any wallet |
| `ContractTransactions` | build the unsigned transactions for mint, top-up, limits, approvals, copy trade and withdrawals |
| `signerFromAccount`, `signerFromWalletClient` | adapt a viem account or wallet client |

## An instance owner

```ts
import { BotsClient, CHAIN_ID, DataClient, signerFromWalletClient } from "@lucrios/sdk";

const data = new DataClient({ baseUrl: DATA_API_URL });
const bots = new BotsClient({ baseUrl: BOTS_API_URL, chainId: CHAIN_ID.testnet });

await bots.login(signerFromWalletClient(walletClient)); // the wallet signs a one-time message

const [market] = await data.listMarkets();
await bots.configureMarket(tokenId, market.id, {
  decision: "platform", // our AI decides; "external" = your own system sends orders
  settings: {
    interval: "1h",
    allocation: "1000",
    trailing_stop: { distance: { kind: "percent", value: "0.05" }, activation: null, stop_loss: null },
  },
});

const statement = await bots.getStatement(tokenId); // test mode: simulated profit minus costs
```

Every instance starts in **test mode**: it runs exactly like a live one, but
orders only mark the price — no transaction is sent and no funds move.

The full version, including the on-chain onboarding, is in
[`examples/owner.ts`](examples/owner.ts).

## Your own system or AI agent

An instance can be driven by your own code instead of our AI. The owner
delegates an **agent key** once; from then on the agent signs orders and needs
no session.

```ts
import { BotsClient, CHAIN_ID, nextNonce, signerFromAccount, validFor } from "@lucrios/sdk";
import { privateKeyToAccount } from "viem/accounts";

const agent = signerFromAccount(privateKeyToAccount(AGENT_PRIVATE_KEY));
const bots = new BotsClient({ baseUrl: BOTS_API_URL, chainId: CHAIN_ID.testnet });

const order = await bots.placeOrder(agent, {
  tokenId,
  marketId,
  side: "enter",
  nonce: nextNonce(),
  validUntil: validFor(300),
});

const done = await bots.waitForOrder(tokenId, order.id); // filled | rejected | expired
```

What the agent key can and cannot do:

- It signs orders (`enter` / `exit`) for markets the owner set to `decision: "external"`.
- It cannot move funds, change limits, change the configuration or log in as the owner.
- It expires (at most 90 days) and the owner can revoke it at any time.
- Every order is bound to the instance, the market, the chain and a nonce: it
  cannot be replayed, reordered or reused on another chain.

Full version in [`examples/agent.ts`](examples/agent.ts).

## On-chain transactions

The SDK never signs or sends a transaction. `ContractTransactions` returns
`{ to, data, value }` for the owner's wallet to sign:

```ts
import { ContractTransactions } from "@lucrios/sdk";

const txs = new ContractTransactions({ nft: NFT_ADDRESS, executor: EXECUTOR_ADDRESS });

await walletClient.sendTransaction(txs.mint(mintPrice, partnerAddress));
await walletClient.sendTransaction(txs.setLimits(tokenId, maxPerTrade));
await walletClient.sendTransaction(txs.approveToken(quoteToken));
await walletClient.sendTransaction(txs.approveToken(baseToken)); // without it a stop cannot be executed
```

The contract ABIs are exported as `botInstanceNftAbi` and `tradeExecutorAbi`
for reads and event decoding.

## Errors

Every failed request throws one of two errors:

| Error | When | Fields |
|---|---|---|
| `ApiError` | the API answered with an error | `status`, `code`, `message`, `retryable`, `details` |
| `NetworkError` | no response at all | `retryable` (always true) |

`code` is stable and meant to be branched on (`UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, `INVALID`, `CONFLICT`, `INSUFFICIENT_CREDITS`, `INTERNAL`).
`retryable` is true only when sending the same request again can succeed
without changing it.

### Out of credits

Every instance has a prepaid credit balance. It pays for the platform AI, for
gas and for API usage: each order your system sends **and the engine executes**
costs a small fixed fee. Rejected and expired orders, and all reads, are free.

When the balance is zero or negative, an order to **enter** is refused with
HTTP 402 and the code `INSUFFICIENT_CREDITS`. An order to **exit** is always
accepted, so an open position can always be closed.

```ts
try {
  await bots.placeOrder(signer, intent);
} catch (error) {
  if (error instanceof ApiError && error.isInsufficientCredits) {
    // Not retryable: top up the instance first (ContractTransactions.topUp).
    console.log("balance:", error.details.balance_eth, "ETH");
  } else {
    throw error;
  }
}
```

## Conventions

- Responses keep the wire format (snake_case).
- Amounts and prices are **decimal strings**. Do not parse them with `Number()`
  when precision matters.
- Timestamps in responses are RFC 3339 strings; `validUntil` in an order is a
  unix timestamp in seconds.

## Development

```bash
npm test            # unit tests
npm run typecheck
npm run build       # ESM + CommonJS + type declarations in dist/
```

`test/e2e.test.ts` runs against a real `bots-api` when `BOTS_API_URL` is set.
