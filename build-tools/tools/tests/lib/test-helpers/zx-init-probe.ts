import "./worker-init";
import { timeAsync } from "./timing";
import { buildToolPath } from "../../../dev/dev-build/paths";

const ZX_INIT_PROBE_LABEL = "zx-init probe (node --import zx-init)";
let zxInitProbeDone = false;
let zxInitProbePromise: Promise<void> | null = null;

export async function ensureZxInitProbedOnce(opts: {
  tmp: string;
  $: any;
  exportEnv: Record<string, string>;
}): Promise<void> {
  if (zxInitProbeDone) return;

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
  return buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
}
