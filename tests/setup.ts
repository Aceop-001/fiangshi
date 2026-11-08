// No network in tests: any fetch is a bug.
process.env.FIANGHSI_OFFLINE = "1";
globalThis.fetch = (() => {
  throw new Error("network disabled in tests");
}) as typeof fetch;
