#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./test-helpers";

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}

async function findForkserverDir(tmp: string): Promise<string | null> {
  const buckOut = path.join(tmp, "buck-out");
  const v2 = path.join(buckOut, "v2", "forkserver");
  try {
    await fsp.access(v2);
    return v2;
  } catch {}
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fsp.readdir(buckOut, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(buckOut, ent.name, "forkserver");
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

// This child exits through runInTemp cleanup; only the interruption fixture keeps its temp root.
delete process.env.TEST_KEEP_TMP;
// Keep early TMP disabled by default; parents should synchronize on READY/TMP emitted below.
if (!Object.prototype.hasOwnProperty.call(process.env, "TEST_EARLY_TMP_STDOUT")) {
  process.env.TEST_EARLY_TMP_STDOUT = "0";
}

await runInTemp("buck-cleanup-nondisruptive-child", async (tmp, $) => {
  console.log(`TMP ${tmp}`);
  await $({
    cwd: tmp,
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    },
  })`buck2 build //.viberoots/workspace:flake.lock`;

  const t0 = Date.now();
  let forkserverReady = false;
  let forkserverPath = "";
  const waitMs = 60_000;
  while (Date.now() - t0 < waitMs) {
    const found = await findForkserverDir(tmp);
    if (found) {
      forkserverPath = found;
      forkserverReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!forkserverReady) {
    console.error(
      `buck cleanup child: forkserver dir did not appear within ${Math.round(waitMs / 1000)}s`,
    );
    process.exit(2);
  }
  if (forkserverPath) {
    console.error(`buck cleanup child: forkserver ready at ${forkserverPath}`);
  }
  console.log("READY");

  const goSignal = path.join(tmp, "go.signal");
  const stopSignal = path.join(tmp, "stop.signal");
  let pinged = false;
  while (true) {
    if (await exists(stopSignal)) return;
    if (!pinged && (await exists(goSignal))) {
      if (await exists(stopSignal)) return;
      // If cleanup from another repo was too broad, this build fails.
      await $`buck2 build //.viberoots/workspace:flake.lock`;
      console.log("PING_OK");
      pinged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});
