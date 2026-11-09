/** Raw fixtures are evidence: never overwrite. If `path` exists, write `<name>-attemptN<ext>` (N = 2, 3, …). */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";

export function noClobberPath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length).replace(/-attempt\d+$/, "");
  for (let n = 2; ; n++) {
    const p = `${stem}-attempt${n}${ext}`;
    if (!existsSync(p)) return p;
  }
}

/** Writes and returns the path actually used. */
export function writeNoClobber(path: string, content: string): string {
  const p = noClobberPath(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}
