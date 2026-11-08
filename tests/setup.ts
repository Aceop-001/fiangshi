// No network in tests: any fetch is a bug. Data writes go to a temp dir, never ./data.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FIANGHSI_OFFLINE = "1";
process.env.SNAPSHOT_SOURCE = "fixture";
process.env.MOCK_MODELS = "good";
process.env.FIANGHSI_DATA_DIR = mkdtempSync(join(tmpdir(), "fiangshi-data-"));
process.env.FIANGHSI_ARTIFACTS_DIR = mkdtempSync(join(tmpdir(), "fiangshi-art-"));
globalThis.fetch = (() => {
  throw new Error("network disabled in tests");
}) as typeof fetch;
