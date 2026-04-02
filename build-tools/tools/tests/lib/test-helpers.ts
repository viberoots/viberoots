#!/usr/bin/env zx-wrapper
import "./test-helpers/worker-init";

export { getTimingCountForLabel } from "./test-helpers/timing";
export { rsyncRepoTo } from "./test-helpers/rsync";
export { mktemp } from "./test-helpers/tmp";
export { exists } from "./test-helpers/fs";
export { runInTemp } from "./test-helpers/run-in-temp";
export {
  buildSelectedOutPath,
  exportGraphInTemp,
  runBuildSelected,
} from "./test-helpers/selected-build";

export function inheritedBuckIsolation(
  defaultIsolation: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return String(env.BUCK_ISOLATION_DIR || env.BUCK_NESTED_ISO || defaultIsolation).trim();
}
