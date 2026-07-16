import path from "node:path";
import * as fsp from "node:fs/promises";
import { probeSeedCowCopyFrom } from "./seed-copy";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;
const CLONE_PROBE_LABEL = "seedStore clone probe (copyFileCloneSupport)";
let supported: true | null = null;
let supportedPromise: Promise<true> | null = null;

export async function requireSeedStoreCow(args: {
  timeAsync: TimeAsync;
  seedPath: string;
  tmpDir: string;
}): Promise<true> {
  if (supported) return supported;
  if (!supportedPromise) {
    supportedPromise = (async () => {
      const hiddenFlake = path.join(args.seedPath, ".viberoots", "workspace", "flake.nix");
      const rootFlake = path.join(args.seedPath, "flake.nix");
      const srcFile = await fsp
        .access(hiddenFlake)
        .then(() => hiddenFlake)
        .catch(() => rootFlake);
      const cloneSupported = await args.timeAsync(
        CLONE_PROBE_LABEL,
        async () => await probeSeedCowCopyFrom({ srcFile, dstDir: args.tmpDir }),
      );
      if (!cloneSupported) {
        throw new Error(
          `runInTemp: seed store CoW clone unsupported for ${args.seedPath}; rerun v on a CoW-capable filesystem`,
        );
      }
      supported = true;
      return supported;
    })();
  }
  return await supportedPromise;
}
