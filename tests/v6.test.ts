import { describe, it, expect } from "vitest";
import { checksumValid, keccak256, toChecksumAddress, v6 } from "../src/core/v6.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("keccak256 (published vectors)", () => {
  it("empty string", () => expect(keccak256(new Uint8Array())).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"));
  it('"abc"', () => expect(keccak256(new TextEncoder().encode("abc"))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"));
});

describe("EIP-55 (vectors from the EIP)", () => {
  const vectors = ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"];
  for (const v of vectors) it(`checksums ${v}`, () => expect(toChecksumAddress(v.toLowerCase())).toBe(v));
  it("Base USDC is correctly checksummed", () => expect(checksumValid(USDC)).toBe(true));
  it("all-lowercase / all-uppercase carry no checksum -> null (not a failure)", () => {
    expect(checksumValid(USDC.toLowerCase())).toBeNull();
    expect(checksumValid("0x" + USDC.slice(2).toUpperCase())).toBeNull();
  });
});

describe("V6 null/sink payee", () => {
  it("zero address, canonical -> BLOCK", () => expect(v6({ payTo: "0x0000000000000000000000000000000000000000" })).toMatchObject({ band: "BLOCK", rule: "zero_address" }));
  it("zero address, any form (0x0, 0X00, no prefix) -> BLOCK", () => {
    for (const z of ["0x0", "0X00", "0".repeat(40), " 0x000 "]) expect(v6({ payTo: z }).rule).toBe("zero_address");
  });
  it("burn sink 0x…dEaD, casing variants -> BLOCK", () => {
    for (const a of ["0x000000000000000000000000000000000000dEaD", "0x000000000000000000000000000000000000dead", "0x000000000000000000000000000000000000DEAD"]) expect(v6({ payTo: a }).rule).toBe("burn_sink");
  });
  it("burn sink dEAD…42069 -> BLOCK", () => expect(v6({ payTo: "0xdEAD000000000000000042069420694206942069" }).rule).toBe("burn_sink"));
  it("payTo == payment-asset contract (any casing) -> BLOCK", () => {
    expect(v6({ payTo: USDC.toLowerCase(), asset: USDC })).toMatchObject({ band: "BLOCK", rule: "payto_is_asset" });
  });
  it("invalid EIP-55 checksum (one letter's case flipped) -> BLOCK", () => {
    const bad = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"; // last d -> D
    expect(v6({ payTo: bad })).toMatchObject({ band: "BLOCK", rule: "bad_checksum" });
  });
  it("no code + zero outbound -> REVIEW only (never BLOCK)", () => {
    expect(v6({ payTo: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", hasCode: false, outboundCount: 0 })).toMatchObject({ band: "REVIEW", rule: "no_code_no_outbound" });
  });
  it("code unknown (no provider) + zero outbound -> does not fire", () => {
    expect(v6({ payTo: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", outboundCount: 0 }).band).toBeNull();
  });
  it("valid control: real checksummed payee, different asset -> passes", () => {
    expect(v6({ payTo: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", asset: USDC, hasCode: false, outboundCount: 12 })).toMatchObject({ band: null, rule: null });
  });
  it("valid control: lowercase payee (no checksum info) passes", () => {
    expect(v6({ payTo: "0xc327d0aeb5f65b514b193b5e5a95cc6f4060815f", asset: USDC }).band).toBeNull();
  });
});

describe("V6 does not misfire on non-addresses", () => {
  it("placeholder / failed-probe payees ('unknown', '0xpayee') carry no checksum -> pass", () => {
    expect(v6({ payTo: "unknown" }).band).toBeNull();
    expect(v6({ payTo: "0xpayee" }).band).toBeNull();
    expect(checksumValid("0xpayee")).toBeNull();
  });
});
