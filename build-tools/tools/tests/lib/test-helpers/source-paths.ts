import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VIBEROOTS_SOURCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

/**
 * Resolve a path inside the checked-out viberoots source tree.
 *
 * Source-inspection tests should use this helper instead of reading
 * `viberoots/...` relative to the process CWD. `v` may execute tests from the
 * parent consumer workspace or from the viberoots checkout; anchoring to this
 * helper keeps those tests independent of invocation directory.
 */
export function viberootsSourcePath(rel: string): string {
  const normalized = rel.replace(/^viberoots\//, "");
  return path.join(VIBEROOTS_SOURCE_ROOT, normalized);
}

/**
 * Copy a checked-out viberoots source path unless the destination is already
 * that same path.
 *
 * Some temp-repo tests copy selected source files into `runInTemp(...)`
 * workspaces. In self-current runs that workspace can already be the checkout,
 * so a raw `fs.copy(source, destination)` can become a same-path copy.
 */
export async function copyViberootsSourcePath(rel: string, destination: string): Promise<void> {
  const source = viberootsSourcePath(rel);
  if (path.resolve(source) === path.resolve(destination)) return;
  if (await fs.pathExists(destination)) {
    const [sourceReal, destinationReal] = await Promise.all([
      fs.realpath(source),
      fs.realpath(destination),
    ]);
    if (sourceReal === destinationReal) return;
  }
  await fs.copy(source, destination);
}
