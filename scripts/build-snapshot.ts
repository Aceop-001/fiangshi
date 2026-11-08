/** Build data/snapshot.json from one batched data pass. Prints snapshot_id and data-call count. */
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "../src/config.js";
import { buildSnapshot, snapshotPath, writeSnapshot } from "../src/snapshot.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv();
  const { snapshot, calls, rejected } = await buildSnapshot();
  writeSnapshot(snapshot);
  console.log(
    `snapshot ${snapshot.snapshot_id} source=${snapshot.payload.source} endpoints=${snapshot.payload.endpoints.length} payees=${snapshot.payload.payees.length} rejected=${rejected} data_calls=${calls} -> ${snapshotPath()}`,
  );
}
