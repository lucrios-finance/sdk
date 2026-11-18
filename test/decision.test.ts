import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { canonicalJson, decisionHash } from "../src/index.js";

describe("decisionHash", () => {
  // The same record and hash are pinned in the bots API
  // (src/domain/decision.golden.json); its CI fails if the two files differ,
  // because then no published decision would match its on-chain hash here.
  const golden = JSON.parse(readFileSync(new URL("./fixtures/decision.golden.json", import.meta.url), "utf8"));

  it("matches the hash the engine writes on-chain", () => {
    expect(decisionHash(golden.payload)).toBe(golden.hash);
  });

  it("does not depend on the order of the fields", () => {
    const reversed = Object.fromEntries(Object.entries(golden.payload).reverse());
    expect(decisionHash(reversed)).toBe(golden.hash);
  });

  it("changes with any field", () => {
    expect(decisionHash({ ...golden.payload, side: "close" })).not.toBe(golden.hash);
    expect(decisionHash({ ...golden.payload, entry_wei: "1000000000000001" })).not.toBe(golden.hash);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and has no spaces", () => {
    expect(canonicalJson({ b: [1, { d: null, c: "x" }], a: "0.10" })).toBe('{"a":"0.10","b":[1,{"c":"x","d":null}]}');
  });
});
