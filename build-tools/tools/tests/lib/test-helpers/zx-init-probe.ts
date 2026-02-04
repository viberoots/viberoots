import "./worker-init";
import path from "node:path";
import { timeAsync } from "./timing";

const ZX_INIT_PROBE_LABEL = "zx-init probe (node --import zx-init)";
let zxInitProbeDone = false;
let zxInitProbePromise: Promise<void> | null = null;

export async function ensureZxInitProbedOnce(opts: {
  tmp: string;
  $: any;
  exportEnv: Record<string, string>;
}): Promise<void> {
  const force = String(process.env.TEST_FORCE_ZX_INIT_PROBE || "") === "1";
  if (!force && zxInitProbeDone) return;

  const doProbe = async () => {
    try {
      await timeAsync(ZX_INIT_PROBE_LABEL, async () => {
        await opts.$({
          cwd: opts.tmp,
          env: opts.exportEnv,
        })`node --experimental-strip-types --import ${opts.exportEnv.ZX_INIT} -e ${"console.log('zx-init-loaded')"}`;
      });
    } catch {}
  };

  if (force) {
    await doProbe();
    return;
  }

  if (!zxInitProbePromise) {
    zxInitProbePromise = (async () => {
      try {
        await doProbe();
      } finally {
        zxInitProbeDone = true;
      }
    })();
  }

  await zxInitProbePromise;
}

export function zxInitPathFromWorkspace(): string {
  return path.join(process.cwd(), "build-tools", "tools", "dev", "zx-init.mjs");
}
