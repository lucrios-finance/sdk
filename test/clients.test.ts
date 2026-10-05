import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  ApiError,
  BotsClient,
  CHAIN_ID,
  DataClient,
  NetworkError,
  signerFromAccount,
  signerFromWalletClient,
} from "../src/index.js";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake fetch: records every call and answers from a queue of responses. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: no response queued");
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status });
  };
  return { fetch, calls };
}

const account = privateKeyToAccount(generatePrivateKey());
const signer = signerFromAccount(account);

function bots(responses: Parameters<typeof fakeFetch>[0], token?: string) {
  const { fetch, calls } = fakeFetch(responses);
  const client = new BotsClient({
    baseUrl: "https://bots.example/",
    chainId: CHAIN_ID.testnet,
    fetch,
    ...(token ? { token } : {}),
  });
  return { client, calls };
}

describe("BotsClient session", () => {
  it("logs in by signing the challenge and then sends the session token", async () => {
    const { client, calls } = bots([
      { body: { address: account.address, nonce: "n1", message: "app wants you to sign in\nNonce: n1", expires_at: "x" } },
      { body: { address: account.address, token: "sess-token", expires_at: "y" } },
      { body: { instances: [] } },
    ]);

    const session = await client.login(signer);
    await client.listInstances();

    expect(session.token).toBe("sess-token");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/auth/nonce");
    expect(calls[0]!.body).toEqual({ address: account.address });

    // The signature sent is over exactly the message the API returned.
    const expected = await account.signMessage({ message: "app wants you to sign in\nNonce: n1" });
    expect(calls[1]!.body).toEqual({ address: account.address, signature: expected });

    expect(calls[2]!.headers["authorization"]).toBe("Bearer sess-token");
    expect(client.isLoggedIn).toBe(true);
  });

  it("refuses owner calls before login instead of sending an unauthenticated request", async () => {
    const { client, calls } = bots([]);

    await expect(client.listInstances()).rejects.toThrow(/Not logged in/);
    expect(calls).toHaveLength(0);
  });

  it("accepts a stored session token", async () => {
    const { client, calls } = bots([{ body: { token_id: 7, balance_eth: "0.004" } }], "stored");

    const credits = await client.getCredits(7);

    expect(credits.balance_eth).toBe("0.004");
    expect(calls[0]!.url.pathname).toBe("/instances/7/credits");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer stored");
  });
});

describe("BotsClient requests", () => {
  it("maps arguments to the wire format", async () => {
    const { client, calls } = bots(
      [{ body: {} }, { body: { positions: [] } }, { body: {} }, { status: 204 }],
      "t",
    );
    const expires = new Date("2026-11-01T00:00:00Z");

    await client.configureMarket(7, "m-1", {
      decision: "external",
      settings: { allocation: "1000", interval: "15m" },
    });
    await client.listPositions(7, { status: "closed", limit: 5 });
    await client.setAgent(7, account.address, expires);
    await client.revokeAgent(7);

    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url.pathname).toBe("/instances/7/markets/m-1");
    expect(calls[0]!.body).toEqual({ decision: "external", settings: { allocation: "1000", interval: "15m" } });

    expect(calls[1]!.url.search).toBe("?status=closed&limit=5");

    expect(calls[2]!.body).toEqual({ address: account.address, expires_at: "2026-11-01T00:00:00.000Z" });
    expect(calls[3]!.method).toBe("DELETE");
  });

  it("places an order without a session, with the fields the API expects", async () => {
    const { client, calls } = bots([{ status: 202, body: { id: "o-1", status: "pending" } }]);

    const order = await client.placeOrder(signer, {
      tokenId: 7,
      marketId: "52e65b17-fb6e-5ba0-0ed8-06f37afcd2da",
      side: "exit",
      nonce: 42,
      validUntil: 1_791_200_000,
    });

    expect(order.status).toBe("pending");
    const call = calls[0]!;
    expect(call.url.pathname).toBe("/instances/7/orders");
    expect(call.headers["authorization"]).toBeUndefined();
    expect(call.body).toMatchObject({
      market_id: "52e65b17-fb6e-5ba0-0ed8-06f37afcd2da",
      side: "exit",
      nonce: 42,
      valid_until: 1_791_200_000,
    });
    expect((call.body as { signature: string }).signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("waits for an order to leave pending", async () => {
    const { client, calls } = bots([
      { body: { id: "o-1", status: "pending" } },
      { body: { id: "o-1", status: "filled", fill_price: "100" } },
    ]);

    const order = await client.waitForOrder(7, "o-1", { intervalMs: 1 });

    expect(order.status).toBe("filled");
    expect(calls).toHaveLength(2);
  });

  it("returns the pending order when the timeout passes", async () => {
    const { client } = bots([{ body: { id: "o-1", status: "pending" } }]);

    const order = await client.waitForOrder(7, "o-1", { timeoutMs: 0 });

    expect(order.status).toBe("pending");
  });
});

describe("errors", () => {
  it("turns an API error body into an ApiError with code and retryability", async () => {
    const { client } = bots(
      [
        { status: 409, body: { code: "CONFLICT", message: "nonce must be greater than every previous order" } },
        { status: 503, body: { code: "INTERNAL", message: "internal error" } },
        { status: 429 },
      ],
      "t",
    );

    const conflict = await client.getInstance(1).catch((e) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({ status: 409, code: "CONFLICT", retryable: false });
    expect(conflict.message).toMatch(/nonce/);

    await expect(client.getInstance(1)).rejects.toMatchObject({ status: 503, retryable: true });
    // No JSON body: the code falls back to the HTTP status.
    await expect(client.getInstance(1)).rejects.toMatchObject({ code: "HTTP_429", retryable: true });
  });

  it("reports a failed connection as a retryable NetworkError", async () => {
    const { client } = bots([new TypeError("fetch failed")], "t");

    const error = await client.getInstance(1).catch((e) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.retryable).toBe(true);
  });
});

describe("DataClient", () => {
  it("lists markets and builds the candle query", async () => {
    const { fetch, calls } = fakeFetch([
      { body: { markets: [{ id: "m-1", symbol: "WETH/USDG" }] } },
      { body: { market_id: "m-1", symbol: "WETH/USDG", interval: "1h", candles: [] } },
      { body: { market_id: "m-1", symbol: "WETH/USDG", interval: "1m", candles: [] } },
    ]);
    const data = new DataClient({ baseUrl: "https://data.example", fetch });

    const markets = await data.listMarkets();
    await data.getCandles("m-1", {
      interval: "1h",
      from: new Date("2026-10-01T00:00:00Z"),
      to: 1_791_000_000,
      limit: 100,
      fill: true,
    });
    await data.getCandles("m-1");

    expect(markets[0]!.symbol).toBe("WETH/USDG");
    expect(calls[1]!.url.pathname).toBe("/markets/m-1/candles");
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      interval: "1h",
      from: String(Date.UTC(2026, 9, 1) / 1000),
      to: "1791000000",
      limit: "100",
      fill: "true",
    });
    // Nothing set: no query string at all.
    expect(calls[2]!.url.search).toBe("");
  });
});

describe("signerFromWalletClient", () => {
  it("passes the account on every call and needs one to exist", async () => {
    const seen: unknown[] = [];
    const walletClient = {
      account: { address: account.address },
      signMessage: async (args: unknown) => (seen.push(args), "0x01" as const),
      signTypedData: async (args: unknown) => (seen.push(args), "0x02" as const),
    };

    const wallet = signerFromWalletClient(walletClient);
    await wallet.signMessage("hi");

    expect(wallet.address).toBe(account.address);
    expect(seen[0]).toEqual({ account: account.address, message: "hi" });
    expect(() => signerFromWalletClient({ ...walletClient, account: undefined })).toThrow(/no account/);
  });
});
