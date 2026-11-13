// No network in tests: any fetch is a bug. Data writes go to a temp dir, never ./data.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pin the clock one hour after the committed census, so its records are fresh and results never depend on today's date.
// Tests about staleness set their own time explicitly.
process.env.FIANGSHI_NOW = "2026-11-09T04:00:00.000Z";
process.env.FIANGSHI_OFFLINE = "1";
process.env.SNAPSHOT_SOURCE = "fixture";
process.env.MOCK_MODELS = "good";
process.env.FIANGSHI_DATA_DIR = mkdtempSync(join(tmpdir(), "fiangshi-data-"));
process.env.FIANGSHI_ARTIFACTS_DIR = mkdtempSync(join(tmpdir(), "fiangshi-art-"));
globalThis.fetch = (() => {
  throw new Error("network disabled in tests");
}) as typeof fetch;
