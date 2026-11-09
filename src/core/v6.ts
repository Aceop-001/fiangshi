/**
 * V6 — null / sink payee. Pure. Runs at PROBE TIME, before any paid call (Surf, SERV, Dolphin).
 *   BLOCK  : zero address (any form) · known burn sink · payTo == the payment-asset contract · invalid EIP-55 checksum
 *   REVIEW : no contract code AND zero outbound transfers (only when both facts are supplied; Fiangshi has no
 *            eth_getCode provider yet, so callers pass hasCode=undefined and this rule cannot fire)
 * Keccak-256 is implemented here (no dependency): Node's "sha3-256" is NIST SHA-3, which pads differently.
 */

// ---------- Keccak-256 (original Keccak padding 0x01, rate 1088 bits)
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccakF(s: bigint[]) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) s[y + x] = s[y + x]! ^ d;
    }
    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + 5 * y]!, ROT[x + 5 * y]!);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & M64 & b[((x + 2) % 5) + 5 * y]!);
    s[0] = s[0]! ^ RC[round]!;
  }
}

export function keccak256(data: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1]! |= 0x80;
  const s = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]!);
      s[i] = s[i]! ^ lane;
    }
    keccakF(s);
  }
  let out = "";
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out += Number((s[i]! >> BigInt(8 * j)) & 0xffn).toString(16).padStart(2, "0");
  return out;
}

// ---------- EIP-55
export function toChecksumAddress(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h = keccak256(new TextEncoder().encode(a));
  return "0x" + [...a].map((ch, i) => (parseInt(h[i]!, 16) >= 8 ? ch.toUpperCase() : ch)).join("");
}

/**
 * null = no checksum information: not a 40-hex address at all (e.g. "unknown" after a failed probe), or all lower- /
 * upper-case hex. true/false = mixed case, valid/invalid. A malformed address never reaches V6 as a "bad checksum".
 */
export function checksumValid(addr: string): boolean | null {
  const body = addr.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(body)) return null;
  if (body === body.toLowerCase() || body === body.toUpperCase()) return null;
  return toChecksumAddress(addr) === "0x" + body;
}

// ---------- sink rules
/** Known burn sinks (lowercase, exact). Extend only with a cited source. */
export const BURN_SINKS: readonly string[] = [
  "0x000000000000000000000000000000000000dead", // common burn address
  "0xdead000000000000000042069420694206942069", // "dEAD…42069" burn address
];

/** Zero address in any form: 0x0, 0x00…, 40 zeros, any case, with or without 0x. */
export const isZeroAddress = (a: string) => /^(0x)?0+$/i.test(a.trim());

export interface V6Input {
  payTo: string; // RAW, as the 402 returned it (case preserved, for EIP-55)
  asset?: string | null; // payment-asset contract from the same 402
  hasCode?: boolean; // undefined = unknown (no code provider wired)
  outboundCount?: number | null;
}
export interface V6Result {
  band: "BLOCK" | "REVIEW" | null;
  rule: "zero_address" | "burn_sink" | "payto_is_asset" | "bad_checksum" | "no_code_no_outbound" | null;
  reason: string;
}

export function v6(i: V6Input): V6Result {
  const raw = i.payTo.trim();
  const low = raw.toLowerCase();
  if (isZeroAddress(raw)) return { band: "BLOCK", rule: "zero_address", reason: `payTo ${raw} is the zero address: funds sent there are unrecoverable` };
  if (BURN_SINKS.includes(low)) return { band: "BLOCK", rule: "burn_sink", reason: `payTo ${raw} is a known burn sink: funds sent there are unrecoverable` };
  if (i.asset && low === i.asset.trim().toLowerCase()) return { band: "BLOCK", rule: "payto_is_asset", reason: `payTo ${raw} is the payment-asset contract itself: tokens sent to their own contract are typically stuck` };
  if (checksumValid(raw) === false) return { band: "BLOCK", rule: "bad_checksum", reason: `payTo ${raw} fails its EIP-55 checksum (mixed case that does not match): likely a typo or tampered address` };
  if (i.hasCode === false && i.outboundCount === 0) return { band: "REVIEW", rule: "no_code_no_outbound", reason: `payTo ${raw} has no contract code and has never sent a transfer` };
  return { band: null, rule: null, reason: "payTo is not a null/sink address and its checksum is valid or absent" };
}
