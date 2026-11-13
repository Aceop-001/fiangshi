/**
 * The reference time for published figures (policy v5). Bands now depend on each record's age, so a figure is only
 * reproducible if the moment it describes is fixed. fixtures/audit/numbers-as-of.json holds that moment; numbers.ts,
 * the sensitivity table and fixture-mode servers evaluate the census at it. The live API always uses the real clock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";

/**
 * Fixture mode (FIANGSHI_REPLAY=1) replays SERV and Dolphin replies recorded against the 9 Nov census, so it serves that
 * census at this moment, one hour after it was taken. It is a recording: it never moves.
 */
export const FIXTURE_TIME = "2026-11-09T04:00:00.000Z";

export function referenceTime(): string {
  const j = JSON.parse(readFileSync(join(ROOT, "fixtures", "audit", "numbers-as-of.json"), "utf8")) as { as_of: string };
  if (!Number.isFinite(Date.parse(j.as_of))) throw new Error("fixtures/audit/numbers-as-of.json: as_of is not an ISO-8601 time");
  return j.as_of;
}

/** Pin the clock to the reference time unless something (a test, an operator) has already pinned it. */
export function pinReferenceTime(): string {
  if (!process.env.FIANGSHI_NOW) process.env.FIANGSHI_NOW = referenceTime();
  return process.env.FIANGSHI_NOW;
}
